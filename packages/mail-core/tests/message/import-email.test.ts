import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createDraft,
  createIdentity,
  createMailAccount,
  createSubmission,
  destroyDraft,
  decodeMimeSection,
  importEmail,
  MailCoreError,
  parseRawEmail,
  queryEmails,
  type BlobId,
  type MailAccountId,
  type MailTransaction,
  type MailUnitOfWork,
} from '../../src';
import { createSeededImportDependencies } from '../helpers/import-harness';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

const multipartRaw = new Uint8Array(
  readFileSync(new URL('../fixtures/multipart.eml', import.meta.url)),
);
const simpleRaw = new Uint8Array(readFileSync(new URL('../fixtures/simple.eml', import.meta.url)));
const relatedRaw = new Uint8Array(
  readFileSync(new URL('../fixtures/related-no-disposition.eml', import.meta.url)),
);

describe('importEmail', () => {
  it('uses the lifecycle tie-break when equal-time imports update a Thread projection', async () => {
    const deps = await createSeededImportDependencies();
    const receivedAt = new Date('2026-01-01T10:00:00.000Z');
    const raw = (messageId: string, body: string, inReplyTo: string | null) =>
      new TextEncoder().encode(
        [
          'From: sender@example.test',
          'To: recipient@example.test',
          `Message-ID: <${messageId}>`,
          ...(inReplyTo === null ? [] : [`In-Reply-To: <${inReplyTo}>`]),
          'Date: Thu, 1 Jan 2026 10:00:00 +0000',
          'Subject: Equal time thread',
          'Content-Type: text/plain; charset=utf-8',
          '',
          body,
        ].join('\r\n'),
      );
    const first = await importEmail(deps.core, {
      ...deps.input,
      remoteEmailId: 'equal-time-first',
      raw: raw('equal-time-first@example.test', 'first projection', null),
      receivedAt,
    });
    const second = await importEmail(deps.core, {
      ...deps.input,
      remoteEmailId: 'equal-time-second',
      raw: raw(
        'equal-time-second@example.test',
        'second projection',
        'equal-time-first@example.test',
      ),
      receivedAt,
    });
    const firstEmail = (await deps.core.inspect.email(first.emailId))!;
    const secondEmail = (await deps.core.inspect.email(second.emailId))!;

    expect(secondEmail.threadId).toBe(firstEmail.threadId);
    expect(secondEmail.id.localeCompare(firstEmail.id)).toBeGreaterThan(0);
    expect(await deps.core.inspect.thread(firstEmail.threadId)).toMatchObject({
      preview: 'second projection',
      participantSummary: 'sender@example.test, recipient@example.test',
    });
  });

  it('publishes a transactional full-body search document without later Blob reads', async () => {
    const deps = await createSeededImportDependencies();
    const marker = 'projection-only-marker';
    const raw = new TextEncoder().encode(
      [
        'From: sender@example.test',
        'To: recipient@example.test',
        'Message-ID: <search-projection@example.test>',
        'Date: Thu, 1 Jan 2026 11:00:00 +0000',
        'Subject: Ordinary subject',
        'Content-Type: text/plain; charset=utf-8',
        '',
        `${'prefix '.repeat(80)}${marker}`,
      ].join('\r\n'),
    );

    const result = await importEmail(deps.core, {
      ...deps.input,
      remoteEmailId: 'remote-search-projection',
      raw,
    });
    const email = (await deps.core.inspect.email(result.emailId))!;
    const rawBlob = (await deps.core.inspect.blobs(deps.input.accountId)).find(
      ({ id }) => id === email.blobId,
    )!;
    await deps.core.blobStore.delete({
      accountId: deps.input.accountId,
      objectKey: rawBlob.objectKey,
    });

    await expect(
      queryEmails(deps.core, {
        accountId: deps.input.accountId,
        filter: { text: marker },
        sort: { property: 'receivedAt', direction: 'asc' },
        limit: 20,
        cursor: null,
      }),
    ).resolves.toMatchObject({ emailIds: [result.emailId] });
  });

  it('publishes one Email and Thread only after every immutable Blob is ready', async () => {
    const deps = await createSeededImportDependencies();

    const result = await importEmail(deps.core, {
      ...deps.input,
      keywords: ['$SEEN'],
    });

    expect(result.created).toBe(true);
    expect(result.emailId).not.toBe(deps.input.remoteEmailId);
    const stored = await deps.core.inspect.email(result.emailId);
    expect(stored).toMatchObject({
      accountId: deps.input.accountId,
      subject: 'Multipart fixture',
      messageId: 'multipart-message@example.test',
      keywords: ['$seen'],
      mailboxIds: deps.input.mailboxIds,
      hasAttachment: true,
    });
    expect(stored?.threadId).toBeTruthy();
    expect(stored).not.toHaveProperty('raw');
    expect(stored?.htmlBody).toContain('<p>Hello</p>');
    expect(await deps.core.inspect.rawBytes(result.emailId)).toEqual(multipartRaw);

    const blobs = await deps.core.inspect.blobs(deps.input.accountId);
    expect(blobs).toHaveLength(1);
    expect(blobs.every(({ status }) => status === 'ready')).toBe(true);
    expect(
      blobs.every(
        ({ objectKey, sha256 }) =>
          objectKey === `mail/${deps.input.accountId}/sha256/${sha256.slice(0, 2)}/${sha256}`,
      ),
    ).toBe(true);
    expect(stored?.parts).toHaveLength(5);
    if (stored === null) {
      throw new Error('expected imported Email');
    }
    const inlinePart = stored.parts.find(({ kind }) => kind === 'inline');
    const attachmentPart = stored.parts.find(({ kind }) => kind === 'attachment');
    const htmlPart = stored.parts.find(({ contentType }) => contentType === 'text/html');
    expect(inlinePart).toBeDefined();
    expect(attachmentPart).toBeDefined();
    expect(htmlPart).toBeDefined();
    if (inlinePart === undefined || attachmentPart === undefined || htmlPart === undefined) {
      throw new Error('expected MIME leaf parts');
    }
    expect(inlinePart.parentPartId).not.toBeNull();
    expect(attachmentPart.parentPartId).not.toBeNull();
    expect(inlinePart.rawBlobId).toBe(stored.blobId);
    expect(attachmentPart.rawBlobId).toBe(stored.blobId);
    expect(htmlPart.rawBlobId).toBe(stored.blobId);
    const rebuilt = await parseRawEmail(multipartRaw, {
      sanitizeHtml: (html) => html,
    });
    const pathByPartId = new Map(stored.parts.map(({ id, partPath }) => [id, partPath]));
    expect(
      stored.parts.map(({ parentPartId, partPath, contentType, charset, disposition, kind }) => ({
        parentPath: parentPartId === null ? null : pathByPartId.get(parentPartId),
        partPath,
        contentType,
        charset,
        disposition,
        kind,
      })),
    ).toEqual(
      rebuilt.parts.map(({ parentPath, partPath, contentType, charset, disposition, kind }) => ({
        parentPath,
        partPath,
        contentType,
        charset,
        disposition,
        kind,
      })),
    );
    const rawBlob = blobs.find(({ id }) => id === inlinePart.rawBlobId)!;
    const inlineEncoded = await deps.core.blobStore.getRange({
      accountId: deps.input.accountId,
      objectKey: rawBlob.objectKey,
      offset: Number(inlinePart.offsetStart),
      length: Number(inlinePart.encodedLength),
    });
    expect(decodeMimeSection(inlineEncoded, inlinePart.transferEncoding)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    const expectedHtml = (
      await parseRawEmail(multipartRaw, {
        sanitizeHtml: (html) => html,
      })
    ).htmlBody;
    expect(stored.htmlBody).toBe(expectedHtml);

    const importChanges = (await deps.core.inspect.changes(deps.input.accountId)).filter(
      ({ stateVersion }) => stateVersion === 2n,
    );
    expect(importChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'email',
          changeType: 'created',
          entityId: result.emailId,
        }),
        expect.objectContaining({
          collection: 'thread',
          changeType: 'created',
          entityId: stored?.threadId,
        }),
      ]),
    );
    expect(importChanges.every(({ stateVersion }) => stateVersion === 2n)).toBe(true);
    expect(await deps.core.inspect.stateVersion(deps.input.accountId)).toBe(2n);
  });

  it('reads each body leaf from its own Raw MIME BlobSection', async () => {
    const deps = await createSeededImportDependencies();
    const raw = new TextEncoder().encode(
      [
        'From: sender@example.test',
        'To: recipient@example.test',
        'Subject: Multiple body leaves',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="body-parts"',
        '',
        '--body-parts',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'First body.',
        '--body-parts',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Second body.',
        '--body-parts--',
        '',
      ].join('\r\n'),
    );

    const result = await importEmail(deps.core, {
      ...deps.input,
      remoteEmailId: 'multiple-body-leaves',
      raw,
    });
    const stored = await deps.core.inspect.email(result.emailId);
    if (stored === null) {
      throw new Error('expected imported Email');
    }
    const blobs = await deps.core.inspect.blobs(deps.input.accountId);
    const rawBlob = blobs.find(({ id }) => id === stored.blobId)!;
    const decoder = new TextDecoder();
    const bodyBytes = await Promise.all(
      stored.parts
        .filter(({ contentType }) => contentType === 'text/plain')
        .map(async (part) => {
          const encoded = await deps.core.blobStore.getRange({
            accountId: deps.input.accountId,
            objectKey: rawBlob.objectKey,
            offset: Number(part.offsetStart),
            length: Number(part.encodedLength),
          });
          return decodeMimeSection(encoded, part.transferEncoding);
        }),
    );

    expect(bodyBytes.map((bytes) => decoder.decode(bytes))).toEqual([
      'First body.',
      'Second body.',
    ]);
  });

  it('returns the existing local ID for the same remote fingerprint without changing state', async () => {
    const deps = await createSeededImportDependencies();
    const first = await importEmail(deps.core, deps.input);
    const stateAfterFirst = await deps.core.inspect.stateVersion(deps.input.accountId);
    const blobsAfterFirst = await deps.core.inspect.blobs(deps.input.accountId);

    await expect(importEmail(deps.core, deps.input)).resolves.toEqual({
      created: false,
      emailId: first.emailId,
    });

    expect(await deps.core.inspect.stateVersion(deps.input.accountId)).toBe(stateAfterFirst);
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toEqual(blobsAfterFirst);
  });

  it('rejects different content for one account, provider, and remote ID', async () => {
    const deps = await createSeededImportDependencies();
    const first = await importEmail(deps.core, deps.input);

    await expect(
      importEmail(deps.core, {
        ...deps.input,
        raw: new TextEncoder().encode('Subject: changed\r\n\r\nchanged'),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    expect(await deps.core.inspect.emails(deps.input.accountId)).toHaveLength(1);
    expect(await deps.core.inspect.email(first.emailId)).not.toBeNull();
  });

  it('validates account ownership and the required Mailbox before storing Blobs', async () => {
    const deps = await createSeededImportDependencies();
    const other = await createMailAccount(deps.core, {
      userId: 'user-2',
      connectionId: 'connection-2',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const otherInbox = (await deps.core.inspect.mailboxes(other.id)).find(
      ({ role }) => role === 'inbox',
    )!;

    await expect(
      importEmail(deps.core, {
        ...deps.input,
        mailboxIds: [otherInbox.id],
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
    await expect(
      importEmail(deps.core, {
        ...deps.input,
        mailboxIds: [],
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_MUST_HAVE_MAILBOX' });
    await expect(
      importEmail(deps.core, {
        ...deps.input,
        accountId: 'missing-account' as MailAccountId,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });

    expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toEqual([]);
    expect(deps.core.blobStore.snapshot()).toEqual(new Map());
    expect(deps.core.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it('compensates Blob promotion failure without exposing partial mail state', async () => {
    const deps = await createSeededImportDependencies({
      failBlobCommit: true,
    });
    const changesBefore = await deps.core.inspect.changes(deps.input.accountId);

    await expect(importEmail(deps.core, deps.input)).rejects.toMatchObject({
      code: 'BLOB_STORE_FAILURE',
    });

    expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
    expect(await deps.core.inspect.threads(deps.input.accountId)).toEqual([]);
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toEqual([]);
    expect(await deps.core.inspect.changes(deps.input.accountId)).toEqual(changesBefore);
    expect(await deps.core.inspect.stateVersion(deps.input.accountId)).toBe(1n);
    expect(deps.core.blobStore.snapshot()).toEqual(new Map());
    expect(deps.core.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it.each(['sha256', 'size'] as const)(
    'rejects commit-time Blob %s corruption and rolls back visibility',
    async (corruptBlobOnCommit) => {
      const deps = await createSeededImportDependencies({
        corruptBlobOnCommit,
      });

      await expect(importEmail(deps.core, deps.input)).rejects.toMatchObject({
        code: 'BLOB_INTEGRITY',
      });

      expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
      expect(await deps.core.inspect.blobs(deps.input.accountId)).toEqual([]);
      expect(deps.core.blobStore.snapshot()).toEqual(new Map());
      expect(deps.core.blobStore.temporarySnapshot()).toEqual(new Map());
    },
  );

  it('counts only unique newly referenced bytes against quota and reuses ready content', async () => {
    const exactQuota = BigInt(multipartRaw.byteLength);
    const deps = await createSeededImportDependencies({
      storageQuotaBytes: exactQuota,
    });

    const first = await importEmail(deps.core, deps.input);
    const second = await importEmail(deps.core, {
      ...deps.input,
      remoteEmailId: 'remote-2',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toHaveLength(1);
    expect(await deps.core.inspect.emails(deps.input.accountId)).toHaveLength(2);
  });

  it('rejects an import exceeding quota without consuming state or storage', async () => {
    const deps = await createSeededImportDependencies({
      storageQuotaBytes: 10n,
    });

    await expect(importEmail(deps.core, deps.input)).rejects.toMatchObject({
      code: 'OVER_QUOTA',
    });

    expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toEqual([]);
    expect(await deps.core.inspect.stateVersion(deps.input.accountId)).toBe(1n);
    expect(deps.core.blobStore.snapshot()).toEqual(new Map());
    expect(deps.core.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it('counts frozen Submission Blobs after its Draft is destroyed', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'frozen-quota-user',
      connectionId: 'frozen-quota-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const inbox = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;
    const identity = await createIdentity(deps, {
      accountId: account.id,
      name: 'Frozen quota sender',
      email: 'frozen-quota@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const draft = await createDraft(deps, {
      accountId: account.id,
      identityId: identity.id,
      replyToEmailId: null,
      to: [{ email: 'recipient@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Frozen quota payload',
      textBody: 'body retained only by the Submission snapshot',
      htmlBody: '',
      attachmentBlobIds: [],
    });
    const submission = await createSubmission(deps, {
      accountId: account.id,
      emailId: draft.id,
      identityId: identity.id,
      idempotencyKey: 'frozen-quota-submission',
      sendAt: null,
    });
    await destroyDraft(deps, { accountId: account.id, emailId: draft.id });
    expect(submission.rawBlobId).toBe(draft.blobId);

    const importOnlyQuota = BigInt(simpleRaw.byteLength);
    await deps.unitOfWork.run((tx) =>
      tx.accounts.update(account.id, {
        storageQuotaBytes: importOnlyQuota,
        updatedAt: deps.clock.now(),
      }),
    );
    const emailsBefore = await deps.inspect.emails(account.id);
    const blobsBefore = await deps.inspect.blobs(account.id);
    const stateBefore = await deps.inspect.stateVersion(account.id);

    await expect(
      importEmail(deps, {
        accountId: account.id,
        provider: 'fixture',
        remoteEmailId: 'frozen-quota-import',
        remoteThreadId: null,
        raw: simpleRaw,
        mailboxIds: [inbox.id],
        keywords: [],
        receivedAt: deps.clock.now(),
      }),
    ).rejects.toMatchObject({ code: 'OVER_QUOTA' });

    expect(await deps.inspect.emails(account.id)).toEqual(emailsBefore);
    expect(await deps.inspect.blobs(account.id)).toEqual(blobsBefore);
    expect(await deps.inspect.stateVersion(account.id)).toBe(stateBefore);
    expect(deps.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it('charges a reused ready Blob when the import makes previously orphaned content referenced', async () => {
    const orphanBytes = multipartRaw;
    const deps = await createSeededImportDependencies({
      storageQuotaBytes: BigInt(multipartRaw.byteLength - 1),
    });
    const orphan = await deps.core.blobStore.putTemporary({
      accountId: deps.input.accountId,
      bytes: orphanBytes,
      contentType: 'message/rfc822',
    });
    const objectKey = 'mail/orphan-attachment';
    await deps.core.blobStore.commitTemporary({
      accountId: deps.input.accountId,
      temporaryKey: orphan.temporaryKey,
      objectKey,
    });
    await deps.core.unitOfWork.run((tx) =>
      tx.blobs.insert({
        id: 'orphan-blob' as BlobId,
        accountId: deps.input.accountId,
        sha256: orphan.sha256,
        sizeBytes: orphan.size,
        contentType: 'message/rfc822',
        objectKey,
        status: 'ready',
        createdAt: deps.core.clock.now(),
        readyAt: deps.core.clock.now(),
        deletedAt: null,
      }),
    );

    await expect(importEmail(deps.core, deps.input)).rejects.toMatchObject({
      code: 'OVER_QUOTA',
    });

    expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toHaveLength(1);
    expect(deps.core.blobStore.snapshot()).toEqual(new Map([[objectKey, orphanBytes]]));
  });

  it('retains promoted objects when transaction commit succeeded but acknowledgement is unknown', async () => {
    const deps = await createSeededImportDependencies();
    deps.core.unitOfWork.failCommitAcknowledgementAfter(2);

    await expect(importEmail(deps.core, deps.input)).rejects.toThrow(
      'transaction commit outcome unknown',
    );

    const [stored] = await deps.core.inspect.emails(deps.input.accountId);
    expect(stored).toBeDefined();
    expect(await deps.core.inspect.rawBytes(stored!.id)).toEqual(multipartRaw);
    expect(deps.core.blobStore.snapshot().size).toBe(1);
    await expect(importEmail(deps.core, deps.input)).resolves.toEqual({
      created: false,
      emailId: stored!.id,
    });
  });

  it('persists normalized text and sanitized HTML as PostgreSQL body projections', async () => {
    const raw = new TextEncoder().encode(
      [
        'From: Body Sender <body@example.test>',
        'To: Body Recipient <recipient@example.test>',
        'Message-ID: <body-blobs@example.test>',
        'Date: Thu, 1 Jan 2026 13:00:00 +0000',
        'Subject: Body blobs',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="body-alternative"',
        '',
        '--body-alternative',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Plain body.',
        '--body-alternative',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>HTML body</p><script>private-script</script>',
        '--body-alternative--',
      ].join('\r\n'),
    );
    const deps = await createSeededImportDependencies({
      sanitizeHtml: (html) => html.replace(/<script>.*?<\/script>/gu, ''),
    });
    const result = await importEmail(deps.core, {
      ...deps.input,
      raw,
      remoteEmailId: 'body-remote',
    });
    const stored = (await deps.core.inspect.email(result.emailId))!;
    expect(stored.textBody).toBe('Plain body.');
    expect(stored.htmlBody).toBe('<p>HTML body</p>');
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toHaveLength(1);
  });

  it('does not delete a pre-existing destination object when conditional promotion rejects', async () => {
    const deps = await createSeededImportDependencies();
    const rawDigest = createHash('sha256').update(deps.input.raw).digest('hex');
    const occupiedKey = `mail/${deps.input.accountId}/sha256/${rawDigest.slice(0, 2)}/${rawDigest}`;
    const originalBytes = new Uint8Array([9, 8, 7]);
    const occupied = await deps.core.blobStore.putTemporary({
      accountId: deps.input.accountId,
      bytes: originalBytes,
      contentType: 'application/octet-stream',
    });
    await deps.core.blobStore.commitTemporary({
      accountId: deps.input.accountId,
      temporaryKey: occupied.temporaryKey,
      objectKey: occupiedKey,
    });

    await expect(importEmail(deps.core, deps.input)).rejects.toMatchObject({
      code: 'BLOB_STORE_FAILURE',
    });

    await expect(
      deps.core.blobStore.get({
        accountId: deps.input.accountId,
        objectKey: occupiedKey,
      }),
    ).resolves.toEqual(originalBytes);
    expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
  });

  it('maps sanitizer and BlobStore failures to safe stable errors', async () => {
    const privateText = 'private-html object/key https://signed.example.test/blob?secret=1';
    const sanitizerDeps = await createSeededImportDependencies({
      sanitizeHtml: () => {
        throw new Error(privateText);
      },
    });
    const sanitizerError = await importEmail(sanitizerDeps.core, sanitizerDeps.input).catch(
      (error: unknown) => error,
    );
    expect(sanitizerError).toMatchObject({ code: 'MIME_PARSE_FAILED' });
    expect(`${String(sanitizerError)}${JSON.stringify(sanitizerError)}`).not.toContain(privateText);

    const blobDeps = await createSeededImportDependencies();
    blobDeps.core.blobStore.commitTemporary = async () => {
      throw new Error(privateText);
    };
    const blobError = await importEmail(blobDeps.core, blobDeps.input).catch(
      (error: unknown) => error,
    );
    expect(blobError).toMatchObject({ code: 'BLOB_STORE_FAILURE' });
    expect(`${String(blobError)}${JSON.stringify(blobError)}`).not.toContain(privateText);

    const knownSanitizerDeps = await createSeededImportDependencies({
      sanitizeHtml: () => {
        throw new MailCoreError('INVALID_EMAIL', { entityId: privateText });
      },
    });
    const knownSanitizerError = await importEmail(
      knownSanitizerDeps.core,
      knownSanitizerDeps.input,
    ).catch((error: unknown) => error);
    expect(knownSanitizerError).toMatchObject({ code: 'INVALID_EMAIL' });
    expect(`${String(knownSanitizerError)}${JSON.stringify(knownSanitizerError)}`).not.toContain(
      privateText,
    );

    const knownBlobDeps = await createSeededImportDependencies();
    knownBlobDeps.core.blobStore.commitTemporary = async () => {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: privateText });
    };
    const knownBlobError = await importEmail(knownBlobDeps.core, knownBlobDeps.input).catch(
      (error: unknown) => error,
    );
    expect(knownBlobError).toMatchObject({ code: 'BLOB_NOT_FOUND' });
    expect(`${String(knownBlobError)}${JSON.stringify(knownBlobError)}`).not.toContain(privateText);
  });

  it.each(['missing', 'corrupt'] as const)(
    'verifies a reused ready Blob object before publishing when it is %s',
    async (failure) => {
      const expectedBytes = multipartRaw;
      const deps = await createSeededImportDependencies();
      const storedBytes = failure === 'missing' ? expectedBytes : new Uint8Array([4, 3, 2, 1]);
      const pending = await deps.core.blobStore.putTemporary({
        accountId: deps.input.accountId,
        bytes: storedBytes,
        contentType: 'message/rfc822',
      });
      const objectKey = `mail/reused-${failure}`;
      await deps.core.blobStore.commitTemporary({
        accountId: deps.input.accountId,
        temporaryKey: pending.temporaryKey,
        objectKey,
      });
      if (failure === 'missing') {
        await deps.core.blobStore.delete({
          accountId: deps.input.accountId,
          objectKey,
        });
      }
      const expected = await deps.core.blobStore.putTemporary({
        accountId: deps.input.accountId,
        bytes: expectedBytes,
        contentType: 'image/png',
      });
      await deps.core.blobStore.deleteTemporary({
        accountId: deps.input.accountId,
        temporaryKey: expected.temporaryKey,
      });
      await deps.core.unitOfWork.run((tx) =>
        tx.blobs.insert({
          id: `reused-${failure}` as BlobId,
          accountId: deps.input.accountId,
          sha256: expected.sha256,
          sizeBytes: expected.size,
          contentType: 'message/rfc822',
          objectKey,
          status: 'ready',
          createdAt: deps.core.clock.now(),
          readyAt: deps.core.clock.now(),
          deletedAt: null,
        }),
      );

      await expect(importEmail(deps.core, deps.input)).rejects.toMatchObject({
        code: 'BLOB_INTEGRITY',
      });
      expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
      expect(await deps.core.inspect.stateVersion(deps.input.accountId)).toBe(1n);
    },
  );

  it('imports a related null-disposition CID part with matching attachment metadata', async () => {
    const deps = await createSeededImportDependencies();
    const result = await importEmail(deps.core, {
      ...deps.input,
      raw: relatedRaw,
      remoteEmailId: 'related-remote',
    });
    const stored = (await deps.core.inspect.email(result.emailId))!;

    expect(stored.hasAttachment).toBe(false);
    expect(stored.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: null,
          kind: 'inline',
        }),
      ]),
    );
  });

  it('uses normalized references and subjects to place a reply in exactly one local Thread', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'thread-user',
      connectionId: 'thread-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const inbox = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;
    const root = await importEmail(deps, {
      accountId: account.id,
      provider: 'fixture',
      remoteEmailId: 'root-remote',
      remoteThreadId: 'provider-thread-ignored',
      raw: simpleRaw,
      mailboxIds: [inbox.id],
      keywords: [],
      receivedAt: new Date('2026-01-01T10:00:00Z'),
    });
    const replyRaw = new TextEncoder().encode(
      [
        'From: Reply <reply@example.test>',
        'To: Simple Sender <sender@example.test>',
        'Message-ID: <reply-message@example.test>',
        'In-Reply-To: <simple-message@EXAMPLE.TEST>',
        'References: <simple-message@EXAMPLE.TEST>',
        'Date: Thu, 1 Jan 2026 12:00:00 +0000',
        'Subject: Re: Simple fixture',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'A reply.',
      ].join('\r\n'),
    );
    const reply = await importEmail(deps, {
      accountId: account.id,
      provider: 'fixture',
      remoteEmailId: 'reply-remote',
      remoteThreadId: 'different-provider-thread',
      raw: replyRaw,
      mailboxIds: [inbox.id],
      keywords: [],
      receivedAt: new Date('2026-01-01T12:00:00Z'),
    });

    expect((await deps.inspect.email(reply.emailId))?.threadId).toBe(
      (await deps.inspect.email(root.emailId))?.threadId,
    );
    expect(await deps.inspect.threads(account.id)).toHaveLength(1);
    expect(
      (await deps.inspect.thread((await deps.inspect.email(root.emailId))!.threadId))?.emailCount,
    ).toBe(2);
  });

  it('reports only Thread and Mailbox properties whose aggregate values changed', async () => {
    const deps = await createSeededImportDependencies();
    const root = await importEmail(deps.core, {
      ...deps.input,
      keywords: ['$seen'],
    });
    const rootEmail = (await deps.core.inspect.email(root.emailId))!;
    const replyRaw = new TextEncoder().encode(
      [
        'From: Read Reply <read-reply@example.test>',
        'To: Multipart Sender <multipart@example.test>',
        'Message-ID: <read-reply@example.test>',
        'In-Reply-To: <multipart-message@example.test>',
        'References: <multipart-message@example.test>',
        'Date: Fri, 2 Jan 2026 12:00:00 +0000',
        'Subject: Re: Multipart fixture',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'A read reply without an attachment.',
      ].join('\r\n'),
    );
    await importEmail(deps.core, {
      ...deps.input,
      remoteEmailId: 'read-reply-remote',
      raw: replyRaw,
      keywords: ['$seen'],
      receivedAt: new Date('2026-01-02T12:00:00.000Z'),
    });
    const state = await deps.core.inspect.stateVersion(deps.input.accountId);
    const changes = (await deps.core.inspect.changes(deps.input.accountId)).filter(
      ({ stateVersion }) => stateVersion === state,
    );

    expect(
      changes.find(
        ({ collection, entityId, changeType }) =>
          collection === 'thread' && entityId === rootEmail.threadId && changeType === 'updated',
      )?.changedProperties,
    ).toEqual(['latestReceivedAt', 'emailCount', 'participantSummary', 'preview']);
    expect(
      changes.find(
        ({ collection, entityId, changeType }) =>
          collection === 'mailbox' &&
          entityId === deps.input.mailboxIds[0] &&
          changeType === 'updated',
      )?.changedProperties,
    ).toEqual(['totalEmails']);
  });

  it('merges bridged local Threads and reports every changed Email and Thread at one state', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'merge-user',
      connectionId: 'merge-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const inbox = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;
    const makeRaw = (messageId: string, references: string[], subject: string): Uint8Array =>
      new TextEncoder().encode(
        [
          'From: Merge Sender <merge@example.test>',
          'To: Merge Recipient <recipient@example.test>',
          `Message-ID: <${messageId}>`,
          ...(references.length === 0
            ? []
            : [
                `In-Reply-To: <${references.at(-1)}>`,
                `References: ${references.map((id) => `<${id}>`).join(' ')}`,
              ]),
          'Date: Thu, 1 Jan 2026 12:00:00 +0000',
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          'Merge fixture.',
        ].join('\r\n'),
      );
    const importRaw = (remoteEmailId: string, raw: Uint8Array) =>
      importEmail(deps, {
        accountId: account.id,
        provider: 'fixture',
        remoteEmailId,
        remoteThreadId: null,
        raw,
        mailboxIds: [inbox.id],
        keywords: [],
        receivedAt: new Date('2026-01-01T12:00:00Z'),
      });
    const first = await importRaw('remote-a', makeRaw('message-a@example.test', [], 'Merge topic'));
    const second = await importRaw(
      'remote-b',
      makeRaw('message-b@example.test', [], 'Merge topic'),
    );
    const firstThreadId = (await deps.inspect.email(first.emailId))!.threadId;
    const secondThreadId = (await deps.inspect.email(second.emailId))!.threadId;
    expect(firstThreadId).not.toBe(secondThreadId);

    const repositoryCalls = { emailUpdate: 0, threadListByAccount: 0 };
    const unitOfWork: MailUnitOfWork = {
      run<Result>(operation: (transaction: MailTransaction) => Promise<Result>): Promise<Result> {
        return deps.unitOfWork.run((tx) =>
          operation({
            ...tx,
            emails: {
              ...tx.emails,
              update: (...args) => {
                repositoryCalls.emailUpdate += 1;
                return tx.emails.update(...args);
              },
            },
            threads: {
              ...tx.threads,
              listByAccount: (accountId) => {
                repositoryCalls.threadListByAccount += 1;
                return tx.threads.listByAccount(accountId);
              },
            },
          }),
        );
      },
    };
    const bridge = await importEmail(
      { ...deps, unitOfWork },
      {
        accountId: account.id,
        provider: 'fixture',
        remoteEmailId: 'remote-bridge',
        remoteThreadId: null,
        raw: makeRaw(
          'message-bridge@example.test',
          ['message-a@example.test', 'message-b@example.test'],
          'Re: Merge topic',
        ),
        mailboxIds: [inbox.id],
        keywords: [],
        receivedAt: new Date('2026-01-01T12:00:00Z'),
      },
    );
    expect(repositoryCalls).toEqual({ emailUpdate: 0, threadListByAccount: 0 });

    const winningThreadId = [firstThreadId, secondThreadId].sort()[0]!;
    const losingThreadId = [firstThreadId, secondThreadId].sort()[1]!;
    const movedEmailId = firstThreadId === losingThreadId ? first.emailId : second.emailId;
    expect((await deps.inspect.email(first.emailId))?.threadId).toBe(winningThreadId);
    expect((await deps.inspect.email(second.emailId))?.threadId).toBe(winningThreadId);
    expect((await deps.inspect.email(bridge.emailId))?.threadId).toBe(winningThreadId);
    expect(await deps.inspect.thread(losingThreadId)).toBeNull();
    expect(await deps.inspect.threads(account.id)).toHaveLength(1);
    expect(await deps.inspect.mailbox(inbox.id)).toMatchObject({
      totalEmails: 3,
      unreadEmails: 3,
      totalThreads: 1,
      unreadThreads: 1,
    });

    const mergeChanges = (await deps.inspect.changes(account.id)).filter(
      ({ stateVersion }) => stateVersion === 4n,
    );
    expect(mergeChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'email',
          entityId: movedEmailId,
          changeType: 'updated',
          changedProperties: ['threadId'],
        }),
        expect.objectContaining({
          collection: 'thread',
          entityId: winningThreadId,
          changeType: 'updated',
        }),
        expect.objectContaining({
          collection: 'thread',
          entityId: losingThreadId,
          changeType: 'destroyed',
        }),
      ]),
    );
  });
});
