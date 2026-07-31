import { describe, expect, it } from 'vitest';

import { createDraft, destroyDraft, updateDraft, type BlobStore } from '../../src';
import { createDraftHarness } from '../helpers/draft-harness';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('Draft Email', () => {
  it('sanitizes persisted Draft HTML and rejects recipient header injection before Blob writes', async () => {
    const h = await createDraftHarness();
    const dependencies = {
      ...h.deps,
      sanitizeHtml: (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ''),
    };
    const draft = await createDraft(dependencies, {
      ...h.content,
      htmlBody: '<p>safe</p><script>alert(1)</script>',
    });
    expect(draft.htmlBody).toBe('<p>safe</p>');
    expect(decode(await h.inspect.rawBytes(draft.id))).not.toContain('<script');

    const objectsBefore = h.deps.blobStore.snapshot();
    const temporaryBefore = h.deps.blobStore.temporarySnapshot();
    await expect(
      createDraft(dependencies, {
        ...h.content,
        to: [{ email: 'victim@example.test>\r\nBcc: attacker@example.test' }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    expect(h.deps.blobStore.snapshot()).toEqual(objectsBefore);
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(temporaryBefore);
    await expect(
      updateDraft(dependencies, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: {
          ...h.content,
          cc: [{ email: 'victim@example.test\r\nBcc: attacker@example.test' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    expect(h.deps.blobStore.snapshot()).toEqual(objectsBefore);
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(temporaryBefore);
  });

  it('uses the single integrity-checked attachment read to render MIME', async () => {
    const h = await createDraftHarness();
    const attachment = await h.seedReadyBlob(new Uint8Array([1, 2, 3, 4]), 'image/png');
    const delegate = h.deps.blobStore;
    let attachmentReads = 0;
    const blobStore: BlobStore = {
      putTemporary: (input) => delegate.putTemporary(input),
      commitTemporary: (input) => delegate.commitTemporary(input),
      deleteTemporary: (input) => delegate.deleteTemporary(input),
      delete: (input) => delegate.delete(input),
      list: (input) => delegate.list(input),
      getRange: (input) => delegate.getRange(input),
      get: async (input) => {
        if (input.objectKey === attachment.objectKey) {
          attachmentReads += 1;
        }
        if (input.objectKey === attachment.objectKey && attachmentReads === 2) {
          throw new Error('temporary object-store outage');
        }
        return delegate.get(input);
      },
    };

    await expect(
      createDraft(
        { ...h.deps, blobStore },
        {
          ...h.content,
          attachmentBlobIds: [attachment.id],
        },
      ),
    ).resolves.toMatchObject({ hasAttachment: true });
    expect(attachmentReads).toBe(1);
  });

  it('retains an existing Draft attachment through its virtual EmailPart Blob id', async () => {
    const h = await createDraftHarness();
    const uploaded = await h.seedReadyBlob(new Uint8Array([1, 2, 3, 4]), 'image/png');
    const draft = await createDraft(h.deps, {
      ...h.content,
      attachmentBlobIds: [uploaded.id],
    });
    const attachment = draft.parts.find(({ kind }) => kind === 'attachment')!;

    const updated = await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: draft.draftRevision,
      content: {
        ...h.content,
        subject: 'Retained attachment',
        attachmentBlobIds: [attachment.id as never],
      },
    });

    expect(updated.hasAttachment).toBe(true);
    expect(updated.parts.filter(({ kind }) => kind === 'attachment')).toHaveLength(1);
    expect(decode(await h.inspect.rawBytes(updated.id))).toContain('AQIDBA==');
  });

  it('creates revision 1 in Drafts with one atomic Email, Thread, and Mailbox change', async () => {
    // Catches missing Draft lifecycle projection, counters, or split state allocation.
    const h = await createDraftHarness();
    const before = await h.inspect.stateVersion();

    const draft = await createDraft(h.deps, h.content);

    expect(draft).toMatchObject({
      lifecycle: 'draft',
      draftRevision: 1,
      keywords: ['$draft'],
      mailboxIds: [h.draftsMailboxId],
      subject: h.content.subject,
      to: h.content.to,
      cc: h.content.cc,
      bcc: h.content.bcc,
      stateVersion: before + 1n,
    });
    expect(draft.messageId).toMatch(/^<[^<>]+@local\.zero>$/u);
    expect(await h.inspect.mailbox(h.draftsMailboxId)).toMatchObject({
      totalEmails: 1,
      unreadEmails: 1,
      totalThreads: 1,
      unreadThreads: 1,
    });
    expect(await h.inspect.thread(draft.id)).toMatchObject({
      emailCount: 1,
      unreadCount: 1,
      preview: h.content.textBody,
    });
    const changes = (await h.inspect.changes()).filter(
      ({ stateVersion }) => stateVersion === draft.stateVersion,
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'email',
          entityId: draft.id,
          changeType: 'created',
        }),
        expect.objectContaining({
          collection: 'thread',
          entityId: draft.threadId,
          changeType: 'created',
        }),
        expect.objectContaining({
          collection: 'mailbox',
          entityId: h.draftsMailboxId,
          changeType: 'updated',
        }),
      ]),
    );
    expect(changes.every(({ stateVersion }) => stateVersion === before + 1n)).toBe(true);
  });

  it('keeps Bcc recipients in private delivery metadata and omits the Bcc header from Raw MIME', async () => {
    const h = await createDraftHarness();

    const draft = await createDraft(h.deps, h.content);
    const raw = decode(await h.inspect.rawBytes(draft.id));

    expect(draft.bcc).toEqual(h.content.bcc);
    expect(raw).not.toMatch(/^Bcc:/gimu);
    expect(raw).not.toContain('blind@example.test');
  });

  it('creates immutable Raw MIME revisions while retaining one local Message-ID', async () => {
    // Catches in-place Blob overwrites, Message-ID regeneration, or a missing optimistic revision.
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    const storedRevision1 = (await h.inspect.email(draft.id))!;
    const raw1 = await h.inspect.rawBytes(draft.id);
    const oldBlobId = storedRevision1.blobId;

    const updated = await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: 1,
      content: {
        ...h.content,
        subject: 'Revised subject',
        textBody: 'Revised plain body.',
        htmlBody: '<p>Revised HTML body.</p>',
      },
    });

    const raw2 = await h.inspect.rawBytes(updated.id);
    expect(updated).toMatchObject({
      draftRevision: 2,
      messageId: draft.messageId,
      subject: 'Revised subject',
    });
    expect(raw2).not.toEqual(raw1);
    expect(decode(raw2)).toContain('Revised subject');
    expect(updated.blobId).not.toBe(storedRevision1.blobId);
    expect(updated.textBody).toBe('Revised plain body.');
    expect(updated.htmlBody).toBe('<p>Revised HTML body.</p>');
    expect(oldBlobId).not.toBeNull();
    expect(await h.inspect.blob(oldBlobId!)).toMatchObject({ status: 'ready' });
  });

  it('stores exactly one new Raw MIME Blob for each Draft revision', async () => {
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    const before = await h.inspect.blobs();

    const updated = await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: 1,
      content: h.content,
    });

    expect(updated.blobId).not.toBe(draft.blobId);
    expect(updated.textBody).toBe(draft.textBody);
    expect(updated.htmlBody).toBe(draft.htmlBody);
    expect(await h.inspect.blobs()).toHaveLength(before.length + 1);
  });

  it('rejects a stale revision without preparing or publishing another revision', async () => {
    // Catches last-writer-wins mutation after a concurrent Draft update.
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: 1,
      content: { ...h.content, subject: 'Winner' },
    });
    const before = await h.inspect.email(draft.id);
    const stateBefore = await h.inspect.stateVersion();
    const blobsBefore = await h.inspect.blobs();

    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: { ...h.content, subject: 'Stale writer' },
      }),
    ).rejects.toMatchObject({ code: 'DRAFT_REVISION_CONFLICT' });

    expect(await h.inspect.email(draft.id)).toEqual(before);
    expect(await h.inspect.stateVersion()).toBe(stateBefore);
    expect(await h.inspect.blobs()).toEqual(blobsBefore);
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it('keeps the reply target immutable and rejects self-referential revisions', async () => {
    // Catches MIME reply headers diverging from the persisted Thread relationship.
    const h = await createDraftHarness();
    const first = await createDraft(h.deps, h.content);
    const second = await createDraft(h.deps, {
      ...h.content,
      subject: 'Second root',
    });
    const before = await h.inspect.stateVersion();

    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: first.id,
        expectedRevision: 1,
        content: {
          ...h.content,
          replyToEmailId: second.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATCH' });
    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: first.id,
        expectedRevision: 1,
        content: {
          ...h.content,
          replyToEmailId: first.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATCH' });
    await h.inspect.setMessageId(second.id, null);
    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: first.id,
        expectedRevision: 1,
        content: {
          ...h.content,
          replyToEmailId: second.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATCH' });

    expect((await h.inspect.email(first.id))?.threadId).toBe(first.threadId);
    expect(await h.inspect.stateVersion()).toBe(before);
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it('updates the normalized subject when a standalone Draft owns its Thread', async () => {
    // Catches stale Thread subject projection after revising a standalone Draft.
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);

    const updated = await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: 1,
      content: {
        ...h.content,
        subject: 'Revised standalone topic',
      },
    });

    expect(await h.inspect.thread(updated.id)).toMatchObject({
      normalizedSubject: 'revised standalone topic',
    });
    expect(
      (await h.inspect.changes()).find(
        ({ stateVersion, collection, entityId }) =>
          stateVersion === updated.stateVersion &&
          collection === 'thread' &&
          entityId === updated.threadId,
      ),
    ).toMatchObject({
      changedProperties: expect.arrayContaining(['normalizedSubject']),
    });
  });

  it('keeps received and sent Email content immutable through Draft commands', async () => {
    // Catches Draft revision or destruction paths accepting terminal Email lifecycles.
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    await h.inspect.setLifecycle(draft.id, 'sent');

    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: h.content,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_CONTENT_IMMUTABLE' });
    await expect(
      destroyDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_CONTENT_IMMUTABLE' });
  });

  it('requires the Identity, reply Email, and attachment Blobs to belong to the account', async () => {
    // Catches cross-account object references leaking into a Draft.
    const h = await createDraftHarness();
    const foreign = await h.createForeignAccount();
    const foreignBlob = await h.seedReadyBlob(
      new TextEncoder().encode('foreign attachment'),
      'text/plain',
      foreign.account.id,
    );
    const foreignDraft = await createDraft(h.deps, {
      ...h.content,
      accountId: foreign.account.id,
      identityId: foreign.identity.id,
    });

    await expect(
      createDraft(h.deps, {
        ...h.content,
        identityId: foreign.identity.id,
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_NOT_FOUND' });
    await expect(
      createDraft(h.deps, {
        ...h.content,
        replyToEmailId: foreignDraft.id,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_FOUND' });
    await expect(
      createDraft(h.deps, {
        ...h.content,
        attachmentBlobIds: [foreignBlob.id],
      }),
    ).rejects.toMatchObject({ code: 'BLOB_NOT_FOUND' });
  });

  it('reuses the referenced Thread and renders reply headers', async () => {
    // Catches reply references being ignored by either Threading or MIME rendering.
    const h = await createDraftHarness();
    const root = await createDraft(h.deps, h.content);

    const reply = await createDraft(h.deps, {
      ...h.content,
      replyToEmailId: root.id,
      subject: `Re: ${h.content.subject}`,
    });
    const raw = decode(await h.inspect.rawBytes(reply.id));

    expect(reply.threadId).toBe(root.threadId);
    expect(reply.inReplyTo).toEqual([root.messageId]);
    expect(reply.references).toEqual([root.messageId]);
    expect(raw).toContain(`In-Reply-To: ${root.messageId}`);
    expect(raw).toContain(`References: ${root.messageId}`);
  });

  it('renders deterministic CRLF MIME while preserving recipient and attachment order', async () => {
    // Catches random boundaries/headers, LF-only output, sorting, or Provider header injection.
    const createRendered = async () => {
      const h = await createDraftHarness();
      const first = await h.seedReadyBlob(new TextEncoder().encode('alpha'), 'text/plain');
      const second = await h.seedReadyBlob(new TextEncoder().encode('beta'), 'text/plain');
      const draft = await createDraft(h.deps, {
        ...h.content,
        attachmentBlobIds: [first.id, second.id],
      });
      return decode(await h.inspect.rawBytes(draft.id));
    };

    const raw1 = await createRendered();
    const raw2 = await createRendered();

    expect(raw2).toBe(raw1);
    expect(raw1.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/u);
    expect(raw1.indexOf('first@example.test')).toBeLessThan(raw1.indexOf('second@example.test'));
    expect(raw1.indexOf('YWxwaGE=')).toBeLessThan(raw1.indexOf('YmV0YQ=='));
    expect(raw1).not.toMatch(/^X-Provider:/imu);
  });

  it('compensates Blob failure without changing Draft metadata or state', async () => {
    // Catches partially committed Raw/body objects or transaction publication on Blob failure.
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    const emailBefore = await h.inspect.email(draft.id);
    const blobsBefore = await h.inspect.blobs();
    const objectsBefore = h.deps.blobStore.snapshot();
    const stateBefore = await h.inspect.stateVersion();
    h.deps.blobStore.setFailCommit(true);

    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: { ...h.content, subject: 'Must not publish' },
      }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE' });

    expect(await h.inspect.email(draft.id)).toEqual(emailBefore);
    expect(await h.inspect.blobs()).toEqual(blobsBefore);
    expect(h.deps.blobStore.snapshot()).toEqual(objectsBefore);
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(new Map());
    expect(await h.inspect.stateVersion()).toBe(stateBefore);
  });

  it('compensates an object created before Blob promotion acknowledgement is lost', async () => {
    // Catches an untracked committed object leaking when promotion succeeds then throws.
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    const emailBefore = await h.inspect.email(draft.id);
    const blobsBefore = await h.inspect.blobs();
    const objectsBefore = h.deps.blobStore.snapshot();
    const stateBefore = await h.inspect.stateVersion();
    h.deps.blobStore.failNextCommitAfterPromotion();

    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: { ...h.content, subject: 'Lost acknowledgement' },
      }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE' });

    expect(await h.inspect.email(draft.id)).toEqual(emailBefore);
    expect(await h.inspect.blobs()).toEqual(blobsBefore);
    expect(h.deps.blobStore.snapshot()).toEqual(objectsBefore);
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(new Map());
    expect(await h.inspect.stateVersion()).toBe(stateBefore);
  });

  it('never deletes content owned by an earlier revision after duplicate promotion fails', async () => {
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    const objectsBefore = h.deps.blobStore.snapshot();
    h.deps.blobStore.failCommitAfterPromotions(1);

    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: h.content,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE' });

    expect(h.deps.blobStore.snapshot()).toEqual(objectsBefore);
    await expect(h.inspect.rawBytes(draft.id)).resolves.toBeTruthy();
  });

  it('rejects non-ready attachments and over-quota Draft content without state changes', async () => {
    // Catches pending Blob references and quota checks that happen after publication.
    const h = await createDraftHarness();
    const pending = await h.seedPendingBlob(new TextEncoder().encode('pending'));
    const before = await h.inspect.stateVersion();

    await expect(
      createDraft(h.deps, {
        ...h.content,
        attachmentBlobIds: [pending.id],
      }),
    ).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' });
    expect(await h.inspect.stateVersion()).toBe(before);

    const quota = await createDraftHarness({ storageQuotaBytes: 1n });
    const quotaBefore = await quota.inspect.stateVersion();
    await expect(createDraft(quota.deps, quota.content)).rejects.toMatchObject({
      code: 'OVER_QUOTA',
    });
    expect(await quota.inspect.stateVersion()).toBe(quotaBefore);
    expect(await quota.inspect.blobs()).toEqual([]);
    expect(quota.deps.blobStore.snapshot()).toEqual(new Map());
    expect(quota.deps.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it('destroys a Draft atomically and leaves revision Blobs as GC candidates', async () => {
    // Catches incomplete projection cleanup, Blob metadata deletion, or split Changes states.
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    const blobIds = [draft.blobId].filter((value) => value !== null);
    const before = await h.inspect.stateVersion();

    const destroyed = await destroyDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
    });

    expect(destroyed).toEqual({
      emailId: draft.id,
      stateVersion: before + 1n,
    });
    expect(await h.inspect.visibleEmail(draft.id)).toBeNull();
    expect(await h.inspect.email(draft.id)).toMatchObject({
      destroyedAt: h.deps.clock.now(),
      mailboxIds: [],
      keywords: [],
      blobId: null,
      messageId: null,
      inReplyTo: [],
      references: [],
      textBody: '',
      htmlBody: '',
      parts: [],
    });
    for (const blobId of blobIds) {
      expect(await h.inspect.blob(blobId)).toMatchObject({ status: 'ready' });
    }
    expect(await h.inspect.mailbox(h.draftsMailboxId)).toMatchObject({
      totalEmails: 0,
      unreadEmails: 0,
      totalThreads: 0,
      unreadThreads: 0,
    });
    const changes = (await h.inspect.changes()).filter(
      ({ stateVersion }) => stateVersion === destroyed.stateVersion,
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'email',
          entityId: draft.id,
          changeType: 'destroyed',
        }),
        expect.objectContaining({
          collection: 'thread',
          entityId: draft.threadId,
          changeType: 'updated',
        }),
        expect.objectContaining({
          collection: 'mailbox',
          entityId: h.draftsMailboxId,
          changeType: 'updated',
        }),
      ]),
    );
    expect(changes.every(({ stateVersion }) => stateVersion === before + 1n)).toBe(true);
  });
});
