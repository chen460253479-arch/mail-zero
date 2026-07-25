import { describe, expect, it } from 'vitest';

import {
  createMailbox,
  destroyEmail,
  destroyMailbox,
  importEmail,
  moveEmailToTrash,
  restoreEmail,
  updateEmail,
} from '../../src';
import { createSeededEmailHarness } from '../helpers/email-harness';

describe('Email Trash and destruction', () => {
  it('moves to Trash, preserves the restore projection, and restores it', async () => {
    const h = await createSeededEmailHarness();
    const custom = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Keep while trashed',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [h.archiveId, custom.id],
    });
    const beforeTrash = await h.inspect.stateVersion();

    const trashed = await moveEmailToTrash(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });

    expect(trashed.mailboxIds).toEqual([custom.id, h.trashId].sort());
    expect((await h.inspect.email(h.emailId))?.restoreMailboxIds).toEqual(
      [h.archiveId, custom.id, h.inboxId].sort(),
    );
    expect(trashed.stateVersion).toBe(beforeTrash + 1n);

    const secondTrash = await moveEmailToTrash(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });
    expect(secondTrash.stateVersion).toBe(trashed.stateVersion);
    expect(secondTrash.mailboxIds).toEqual([custom.id, h.trashId].sort());
    expect((await h.inspect.email(h.emailId))?.restoreMailboxIds).toEqual(
      [h.archiveId, custom.id, h.inboxId].sort(),
    );

    const restored = await restoreEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });
    expect(restored.mailboxIds).toEqual([h.archiveId, custom.id, h.inboxId].sort());
    expect((await h.inspect.email(h.emailId))?.restoreMailboxIds).toEqual([]);
  });

  it('restores to Inbox when every projected Mailbox was removed', async () => {
    const h = await createSeededEmailHarness();
    const custom = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Temporary destination',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [custom.id],
      removeMailboxIds: [h.inboxId],
    });
    await moveEmailToTrash(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      removeMailboxIds: [custom.id],
    });
    expect((await h.inspect.email(h.emailId))?.restoreMailboxIds).toEqual([]);
    await destroyMailbox(h.deps, {
      accountId: h.accountId,
      mailboxId: custom.id,
    });

    const restored = await restoreEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });

    expect(restored.mailboxIds).toEqual([h.inboxId]);
  });

  it('updates the restore projection for Mailbox patches while trashed', async () => {
    const h = await createSeededEmailHarness();
    const removed = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Removed projection',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    const added = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Added projection',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [removed.id],
    });
    await moveEmailToTrash(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });

    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [added.id],
      removeMailboxIds: [removed.id],
    });

    expect((await h.inspect.email(h.emailId))?.restoreMailboxIds).toEqual(
      [added.id, h.inboxId].sort(),
    );
    await expect(
      restoreEmail(h.deps, {
        accountId: h.accountId,
        emailId: h.emailId,
      }),
    ).resolves.toMatchObject({
      mailboxIds: [added.id, h.inboxId].sort(),
    });
  });

  it('normalizes a direct Trash addition before treating move-to-Trash as a no-op', async () => {
    const h = await createSeededEmailHarness();
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [h.trashId],
    });
    const before = await h.inspect.stateVersion();

    const moved = await moveEmailToTrash(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });

    expect(moved.mailboxIds).toEqual([h.trashId]);
    expect((await h.inspect.email(h.emailId))?.restoreMailboxIds).toEqual([h.inboxId]);
    expect(moved.stateVersion).toBe(before + 1n);
  });

  it('permanently destroys visible state while retaining a tombstone for Blob GC', async () => {
    const h = await createSeededEmailHarness({ keywords: ['$flagged'] });
    const rawBlob = await h.inspect.rawBlob(h.emailId);
    const before = await h.inspect.stateVersion();

    const destroyed = await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });

    expect(destroyed).toEqual({
      emailId: h.emailId,
      stateVersion: before + 1n,
    });
    expect(await h.inspect.visibleEmail(h.emailId)).toBeNull();
    expect(await h.inspect.email(h.emailId)).toMatchObject({
      destroyedAt: h.clock.now(),
      identityId: null,
      mailboxIds: [],
      restoreMailboxIds: [],
      keywords: [],
      blobId: null,
      messageId: null,
      inReplyTo: [],
      references: [],
      subject: '',
      preview: '',
      sizeBytes: 0n,
      hasAttachment: false,
      sender: [],
      from: [],
      replyTo: [],
      to: [],
      cc: [],
      bcc: [],
      textBlobId: null,
      htmlBlobId: null,
      parseWarnings: [],
      parts: [],
    });
    expect(await h.deps.inspect.searchDocument(h.emailId)).toBeNull();
    expect(await h.inspect.blob(rawBlob.id)).not.toBeNull();
    expect(await h.inspect.mailbox(h.inboxId)).toMatchObject({
      totalEmails: 0,
      unreadEmails: 0,
      totalThreads: 0,
      unreadThreads: 0,
    });
    expect(await h.inspect.thread(h.threadId)).toMatchObject({
      emailCount: 0,
      unreadCount: 0,
      hasAttachment: false,
    });
    const changes = (await h.inspect.changes()).filter(
      ({ stateVersion }) => stateVersion === destroyed.stateVersion,
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'email',
          entityId: h.emailId,
          changeType: 'destroyed',
        }),
        expect.objectContaining({
          collection: 'thread',
          entityId: h.threadId,
          changeType: 'updated',
        }),
        expect.objectContaining({
          collection: 'mailbox',
          entityId: h.inboxId,
          changeType: 'updated',
        }),
      ]),
    );
    expect(changes.every(({ stateVersion }) => stateVersion === before + 1n)).toBe(true);
  });

  it('does not allocate another state when destroying an existing tombstone', async () => {
    const h = await createSeededEmailHarness();
    const first = await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });
    const changes = await h.inspect.changes();

    const second = await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });

    expect(second).toEqual(first);
    expect(await h.inspect.stateVersion()).toBe(first.stateVersion);
    expect(await h.inspect.changes()).toEqual(changes);
  });

  it('does not reuse a Thread supported only by a destroyed tombstone', async () => {
    const h = await createSeededEmailHarness();
    await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });
    const replyRaw = new TextEncoder().encode(
      [
        'From: Reply <reply@example.test>',
        'To: Simple Sender <sender@example.test>',
        'Message-ID: <reply-after-destroy@example.test>',
        'In-Reply-To: <simple-message@example.test>',
        'References: <simple-message@example.test>',
        'Date: Thu, 1 Jan 2026 12:00:00 +0000',
        'Subject: Re: Simple fixture',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Reply after local destruction.',
      ].join('\r\n'),
    );

    const reply = await importEmail(h.deps, {
      accountId: h.accountId,
      provider: 'fixture',
      remoteEmailId: 'reply-after-destroy',
      remoteThreadId: null,
      raw: replyRaw,
      mailboxIds: [h.inboxId],
      keywords: [],
      receivedAt: h.clock.now(),
    });

    const replyThreadId = (await h.inspect.email(reply.emailId))!.threadId;
    expect(replyThreadId).not.toBe(h.threadId);
    expect(await h.inspect.thread(h.threadId)).toMatchObject({
      emailCount: 0,
      unreadCount: 0,
    });
    expect(await h.inspect.thread(replyThreadId)).toMatchObject({
      emailCount: 1,
      unreadCount: 1,
    });
  });

  it('does not reparent or report a destroyed tombstone during a bridge merge', async () => {
    const h = await createSeededEmailHarness();
    const makeRaw = (messageId: string, references: string[], body: string): Uint8Array =>
      new TextEncoder().encode(
        [
          'From: Bridge Sender <bridge@example.test>',
          'To: Simple Sender <sender@example.test>',
          `Message-ID: <${messageId}>`,
          ...(references.length === 0
            ? []
            : [
                `In-Reply-To: <${references.at(-1)}>`,
                `References: ${references.map((value) => `<${value}>`).join(' ')}`,
              ]),
          'Date: Thu, 1 Jan 2026 12:00:00 +0000',
          'Subject: Re: Simple fixture',
          'Content-Type: text/plain; charset=utf-8',
          '',
          body,
        ].join('\r\n'),
      );
    const importRaw = (remoteEmailId: string, raw: Uint8Array, receivedAt: string) =>
      importEmail(h.deps, {
        accountId: h.accountId,
        provider: 'fixture',
        remoteEmailId,
        remoteThreadId: null,
        raw,
        mailboxIds: [h.inboxId],
        keywords: [],
        receivedAt: new Date(receivedAt),
      });
    const rootB = await importRaw(
      'tombstone-bridge-root-b',
      makeRaw('tombstone-root-b@example.test', [], 'Second root.'),
      '2026-01-01T01:00:00.000Z',
    );
    const replyB = await importRaw(
      'tombstone-bridge-reply-b',
      makeRaw('tombstone-reply-b@example.test', ['tombstone-root-b@example.test'], 'Second reply.'),
      '2026-01-01T02:00:00.000Z',
    );
    await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: rootB.emailId,
    });
    const tombstoneBeforeBridge = await h.inspect.email(rootB.emailId);

    await importRaw(
      'tombstone-bridge',
      makeRaw(
        'tombstone-bridge@example.test',
        ['simple-message@example.test', 'tombstone-reply-b@example.test'],
        'Bridge.',
      ),
      '2026-01-01T03:00:00.000Z',
    );
    const bridgeState = await h.inspect.stateVersion();

    expect((await h.inspect.email(replyB.emailId))?.threadId).toBe(h.threadId);
    expect(await h.inspect.email(rootB.emailId)).toEqual(tombstoneBeforeBridge);
    expect(await h.inspect.thread(tombstoneBeforeBridge!.threadId)).toMatchObject({
      emailCount: 0,
      unreadCount: 0,
    });
    const bridgeChanges = (await h.inspect.changes()).filter(
      ({ stateVersion }) => stateVersion === bridgeState,
    );
    expect(
      bridgeChanges.find(
        ({ collection, entityId, changeType }) =>
          collection === 'thread' &&
          entityId === tombstoneBeforeBridge!.threadId &&
          changeType === 'updated',
      )?.changedProperties,
    ).toEqual(['emailCount', 'unreadCount', 'participantSummary', 'preview']);
    expect(
      bridgeChanges.filter(
        ({ collection, entityId, changeType }) =>
          collection === 'email' && entityId === rootB.emailId && changeType === 'updated',
      ),
    ).toEqual([]);
  });

  it('reprojects Thread summary fields after destroying its latest Email', async () => {
    const h = await createSeededEmailHarness();
    const replyReceivedAt = new Date('2026-01-02T00:00:00.000Z');
    const replyRaw = new TextEncoder().encode(
      [
        'From: Later Reply <later@example.test>',
        'To: Simple Sender <sender@example.test>',
        'Message-ID: <latest-reply@example.test>',
        'In-Reply-To: <simple-message@example.test>',
        'References: <simple-message@example.test>',
        'Date: Fri, 2 Jan 2026 12:00:00 +0000',
        'Subject: Re: Simple fixture',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'The latest reply.',
      ].join('\r\n'),
    );
    const reply = await importEmail(h.deps, {
      accountId: h.accountId,
      provider: 'fixture',
      remoteEmailId: 'latest-reply',
      remoteThreadId: null,
      raw: replyRaw,
      mailboxIds: [h.inboxId],
      keywords: [],
      receivedAt: replyReceivedAt,
    });
    expect(await h.inspect.thread(h.threadId)).toMatchObject({
      latestReceivedAt: replyReceivedAt,
      preview: 'The latest reply.',
    });

    const result = await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: reply.emailId,
    });

    expect(await h.inspect.thread(h.threadId)).toMatchObject({
      latestReceivedAt: h.clock.now(),
      emailCount: 1,
      unreadCount: 1,
      participantSummary: 'Simple Sender, Simple Recipient',
      preview: 'Hello from the simple fixture.',
    });
    expect(
      (await h.inspect.changes()).find(
        ({ stateVersion, collection }) =>
          stateVersion === result.stateVersion && collection === 'thread',
      ),
    ).toMatchObject({
      changedProperties: [
        'latestReceivedAt',
        'emailCount',
        'unreadCount',
        'participantSummary',
        'preview',
      ],
    });
  });
});
