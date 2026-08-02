import { describe, expect, it } from 'vitest';

import {
  createMailAccount,
  createMailCore,
  createMailCoreMaintenance,
  createMailbox,
  updateEmail,
  type EmailId,
  type EmailLifecycle,
  type MailboxRole,
} from '../../src';
import { createSeededEmailHarness } from '../helpers/email-harness';

const systemMailbox = async (
  h: Awaited<ReturnType<typeof createSeededEmailHarness>>,
  role: MailboxRole,
) => {
  const mailbox = (await h.deps.inspect.mailboxes(h.accountId)).find(
    (candidate) => candidate.role === role,
  );
  if (!mailbox) throw new Error(`missing ${role} mailbox`);
  return mailbox;
};

const seedLifecycleEmail = async (
  h: Awaited<ReturnType<typeof createSeededEmailHarness>>,
  lifecycle: Extract<EmailLifecycle, 'draft' | 'sent'>,
  mailboxRole: Extract<MailboxRole, 'drafts' | 'sent'>,
) => {
  const source = await h.inspect.email(h.emailId);
  if (!source) throw new Error('missing source email');
  const mailbox = await systemMailbox(h, mailboxRole);
  const emailId = `${lifecycle}-email` as EmailId;
  await h.deps.unitOfWork.run((tx) =>
    tx.emails.insert({
      ...source,
      id: emailId,
      lifecycle,
      mailboxIds: [mailbox.id],
      keywords: lifecycle === 'draft' ? ['$draft'] : [],
      draftRevision: lifecycle === 'draft' ? 1 : 0,
      messageId: `<${lifecycle}@example.test>`,
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    }),
  );
  return { emailId, mailboxId: mailbox.id };
};

describe('moveThreadEmails', () => {
  it('moves received email to one custom folder while preserving every label', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const folder = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Projects',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    const firstLabel = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Customer',
      kind: 'label',
      role: null,
      parentId: null,
    });
    const secondLabel = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Urgent',
      kind: 'label',
      role: null,
      parentId: null,
    });
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [firstLabel.id, secondLabel.id],
    });
    const oldState = await h.inspect.stateVersion();

    const result = await core.moveThreadEmails({
      accountId: h.accountId,
      threadIds: [h.threadId, h.threadId],
      destinationMailboxId: folder.id,
      ifInState: oldState.toString(),
    });

    expect(result).toMatchObject({
      oldState: oldState.toString(),
      movedThreadIds: [h.threadId],
      failed: {},
    });
    expect(BigInt(result.newState)).toBeGreaterThan(oldState);
    const moved = await h.inspect.email(h.emailId);
    expect(moved?.mailboxIds).toEqual(
      expect.arrayContaining([folder.id, firstLabel.id, secondLabel.id]),
    );
    expect(moved?.mailboxIds).not.toContain(h.inboxId);
    expect(await h.inspect.mailbox(h.inboxId)).toMatchObject({ totalEmails: 0, totalThreads: 0 });
    expect(await h.inspect.mailbox(folder.id)).toMatchObject({ totalEmails: 1, totalThreads: 1 });
  });

  it('moves only received email in a mixed thread and leaves sent and draft lifecycle mailboxes unchanged', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const archive = await systemMailbox(h, 'archive');
    const sent = await seedLifecycleEmail(h, 'sent', 'sent');
    const draft = await seedLifecycleEmail(h, 'draft', 'drafts');
    await createMailCoreMaintenance(h.deps).reconcileMailAggregates({
      accountId: h.accountId,
      repair: true,
    });

    const result = await core.moveThreadEmails({
      accountId: h.accountId,
      threadIds: [h.threadId],
      destinationMailboxId: archive.id,
    });

    expect(result.movedThreadIds).toEqual([h.threadId]);
    expect((await h.inspect.email(h.emailId))?.mailboxIds).toContain(archive.id);
    expect((await h.inspect.email(sent.emailId))?.mailboxIds).toEqual([sent.mailboxId]);
    expect((await h.inspect.email(draft.emailId))?.mailboxIds).toEqual([draft.mailboxId]);
  });

  it('archives only emails in the selected Sent source mailbox', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const archive = await systemMailbox(h, 'archive');
    const sent = await seedLifecycleEmail(h, 'sent', 'sent');
    const draft = await seedLifecycleEmail(h, 'draft', 'drafts');
    await createMailCoreMaintenance(h.deps).reconcileMailAggregates({
      accountId: h.accountId,
      repair: true,
    });

    const result = await core.moveThreadEmails({
      accountId: h.accountId,
      threadIds: [h.threadId],
      sourceMailboxId: sent.mailboxId,
      destinationMailboxId: archive.id,
    });

    expect(result).toMatchObject({ movedThreadIds: [h.threadId], failed: {} });
    expect((await h.inspect.email(sent.emailId))?.mailboxIds).toEqual([archive.id]);
    expect((await h.inspect.email(sent.emailId))?.lifecycle).toBe('sent');
    expect((await h.inspect.email(h.emailId))?.mailboxIds).toEqual([h.inboxId]);
    expect((await h.inspect.email(draft.emailId))?.mailboxIds).toEqual([draft.mailboxId]);
  });

  it('reports a source mismatch instead of returning a false successful move', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const sent = await systemMailbox(h, 'sent');

    const result = await core.moveThreadEmails({
      accountId: h.accountId,
      threadIds: [h.threadId],
      sourceMailboxId: sent.id,
      destinationMailboxId: h.archiveId,
    });

    expect(result.movedThreadIds).toEqual([]);
    expect(result.failed).toEqual({
      [h.threadId]: { code: 'INVALID_PATCH', details: { entityId: h.threadId } },
    });
    expect((await h.inspect.email(h.emailId))?.mailboxIds).toEqual([h.inboxId]);
  });

  it('unarchives received and sent emails to their lifecycle mailboxes in one mixed thread', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const archive = await systemMailbox(h, 'archive');
    const sent = await seedLifecycleEmail(h, 'sent', 'sent');
    const sentMailbox = await systemMailbox(h, 'sent');
    await createMailCoreMaintenance(h.deps).reconcileMailAggregates({
      accountId: h.accountId,
      repair: true,
    });

    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [archive.id],
      removeMailboxIds: [h.inboxId],
    });
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: sent.emailId,
      addMailboxIds: [archive.id],
      removeMailboxIds: [sent.mailboxId],
    });

    const result = await core.restoreArchivedThreadEmails({
      accountId: h.accountId,
      threadIds: [h.threadId],
    });

    expect(result).toMatchObject({ movedThreadIds: [h.threadId], failed: {} });
    expect((await h.inspect.email(h.emailId))?.mailboxIds).toEqual([h.inboxId]);
    expect((await h.inspect.email(sent.emailId))?.mailboxIds).toEqual([sentMailbox.id]);
  });

  it('rejects labels, lifecycle mailboxes, and cross-account folders as destinations', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const label = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Not a destination',
      kind: 'label',
      role: null,
      parentId: null,
    });
    const sent = await systemMailbox(h, 'sent');
    const otherAccount = await createMailAccount(h.deps, {
      userId: 'other-user',
      connectionId: 'other-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const foreignFolder = await createMailbox(h.deps, {
      accountId: otherAccount.id,
      name: 'Foreign folder',
      kind: 'folder',
      role: null,
      parentId: null,
    });

    await expect(
      core.moveThreadEmails({
        accountId: h.accountId,
        threadIds: [h.threadId],
        destinationMailboxId: label.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATCH' });
    await expect(
      core.moveThreadEmails({
        accountId: h.accountId,
        threadIds: [h.threadId],
        destinationMailboxId: sent.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    await expect(
      core.moveThreadEmails({
        accountId: h.accountId,
        threadIds: [h.threadId],
        destinationMailboxId: foreignFolder.id,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
  });

  it('moves valid threads once and reports missing threads as per-item failures', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);

    const result = await core.moveThreadEmails({
      accountId: h.accountId,
      threadIds: [h.threadId, 'missing-thread' as typeof h.threadId, h.threadId],
      destinationMailboxId: h.archiveId,
    });

    expect(result.movedThreadIds).toEqual([h.threadId]);
    expect(result.failed).toEqual({
      'missing-thread': {
        code: 'THREAD_NOT_FOUND',
        details: { entityId: 'missing-thread' },
      },
    });
  });

  it('rejects a stale state before moving any email', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);

    await expect(
      core.moveThreadEmails({
        accountId: h.accountId,
        threadIds: [h.threadId],
        destinationMailboxId: h.archiveId,
        ifInState: '0',
      }),
    ).rejects.toMatchObject({ code: 'STATE_MISMATCH' });
    expect((await h.inspect.email(h.emailId))?.mailboxIds).toEqual([h.inboxId]);
  });
});
