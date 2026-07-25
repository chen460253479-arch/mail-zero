import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createMailAccount,
  importEmail,
  parseRawEmail,
  type BlobId,
  type MailAccountId,
} from '../../src';
import { createSeededImportDependencies } from '../helpers/import-harness';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

const multipartRaw = new Uint8Array(
  readFileSync(new URL('../fixtures/multipart.eml', import.meta.url)),
);
const simpleRaw = new Uint8Array(readFileSync(new URL('../fixtures/simple.eml', import.meta.url)));

describe('importEmail', () => {
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
    expect(stored).not.toHaveProperty('htmlBody');
    expect(await deps.core.inspect.rawBytes(result.emailId)).toEqual(multipartRaw);

    const blobs = await deps.core.inspect.blobs(deps.input.accountId);
    expect(blobs).toHaveLength(2);
    expect(blobs.every(({ status }) => status === 'ready')).toBe(true);
    expect(stored?.parts).toHaveLength(2);
    expect(stored?.parts[0]?.blobId).toBe(stored?.parts[1]?.blobId);
    const attachmentBlob = blobs.find(({ id }) => id === stored?.parts[0]?.blobId)!;
    await expect(deps.core.blobStore.get(attachmentBlob.objectKey)).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

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

    await expect(importEmail(deps.core, deps.input)).rejects.toThrow('blob commit failed');

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
    const parsed = await parseRawEmail(multipartRaw, {
      sanitizeHtml: (html) => html,
    });
    const uniqueAttachmentSize = parsed.attachments[0]!.sizeBytes;
    const exactQuota = BigInt(multipartRaw.byteLength) + uniqueAttachmentSize;
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
    expect(await deps.core.inspect.blobs(deps.input.accountId)).toHaveLength(2);
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

  it('charges a reused ready Blob when the import makes previously orphaned content referenced', async () => {
    const parsed = await parseRawEmail(multipartRaw, {
      sanitizeHtml: (html) => html,
    });
    const orphanBytes = parsed.attachments[0]!.bytes;
    const deps = await createSeededImportDependencies({
      storageQuotaBytes: BigInt(multipartRaw.byteLength),
    });
    const orphan = await deps.core.blobStore.putTemporary({
      accountId: deps.input.accountId,
      bytes: orphanBytes,
      contentType: 'image/png',
    });
    const objectKey = 'mail/orphan-attachment';
    await deps.core.blobStore.commitTemporary({
      temporaryKey: orphan.temporaryKey,
      objectKey,
    });
    await deps.core.unitOfWork.run((tx) =>
      tx.blobs.insert({
        id: 'orphan-blob' as BlobId,
        accountId: deps.input.accountId,
        sha256: orphan.sha256,
        sizeBytes: orphan.size,
        contentType: 'image/png',
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
    expect(deps.core.blobStore.snapshot().size).toBe(2);
    await expect(importEmail(deps.core, deps.input)).resolves.toEqual({
      created: false,
      emailId: stored!.id,
    });
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

    const bridge = await importRaw(
      'remote-bridge',
      makeRaw(
        'message-bridge@example.test',
        ['message-a@example.test', 'message-b@example.test'],
        'Re: Merge topic',
      ),
    );

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
