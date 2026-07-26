import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createDraft,
  createIdentity,
  createMailAccount,
  updateEmail,
  type MailTransaction,
  type MailUnitOfWork,
  type UpdateEmailInput,
} from '../../src';
import { createSeededEmailHarness } from '../helpers/email-harness';

describe('updateEmail', () => {
  it('does not scan account-wide Email or Mailbox repositories to maintain aggregates', async () => {
    const h = await createSeededEmailHarness();
    const repositoryCalls = {
      emailListByAccount: 0,
      mailboxListByAccount: 0,
      aggregateReconciliations: 0,
    };
    const unitOfWork: MailUnitOfWork = {
      run<Result>(operation: (transaction: MailTransaction) => Promise<Result>): Promise<Result> {
        return h.deps.unitOfWork.run((tx) =>
          operation({
            ...tx,
            emails: {
              ...tx.emails,
              listByAccount: (accountId) => {
                repositoryCalls.emailListByAccount += 1;
                return tx.emails.listByAccount(accountId);
              },
            },
            mailboxes: {
              ...tx.mailboxes,
              listByAccount: (accountId) => {
                repositoryCalls.mailboxListByAccount += 1;
                return tx.mailboxes.listByAccount(accountId);
              },
            },
            mailAggregateMaintenance: {
              reconcile: (input) => {
                repositoryCalls.aggregateReconciliations += 1;
                return tx.mailAggregateMaintenance.reconcile(input);
              },
            },
          }),
        );
      },
    };

    await updateEmail(
      { ...h.deps, unitOfWork },
      {
        accountId: h.accountId,
        emailId: h.emailId,
        addKeywords: ['$seen'],
      },
    );

    expect(repositoryCalls).toEqual({
      emailListByAccount: 0,
      mailboxListByAccount: 0,
      aggregateReconciliations: 0,
    });
  });

  it('patches normalized Mailboxes and Keywords with one state version', async () => {
    const h = await createSeededEmailHarness({ keywords: [] });
    const before = await h.inspect.stateVersion();
    const updated = await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [h.archiveId, h.archiveId],
      removeMailboxIds: [h.inboxId, h.inboxId],
      addKeywords: ['$SEEN', '$flagged', '$seen'],
    });

    expect(updated.mailboxIds).toEqual([h.archiveId]);
    expect(updated.keywords).toEqual(['$flagged', '$seen']);
    expect(updated.stateVersion).toBe(before + 1n);
    expect(await h.inspect.stateVersion()).toBe(before + 1n);
    expect(await h.inspect.mailbox(h.inboxId)).toMatchObject({
      totalEmails: 0,
      unreadEmails: 0,
    });
    expect(await h.inspect.mailbox(h.archiveId)).toMatchObject({
      totalEmails: 1,
      unreadEmails: 0,
    });
    expect(await h.inspect.thread(h.threadId)).toMatchObject({
      emailCount: 1,
      unreadCount: 0,
    });
  });

  it('rejects an empty Mailbox set without state or Change records', async () => {
    const h = await createSeededEmailHarness();
    const beforeState = await h.inspect.stateVersion();
    const beforeChanges = await h.inspect.changes();

    await expect(
      updateEmail(h.deps, {
        accountId: h.accountId,
        emailId: h.emailId,
        removeMailboxIds: [h.inboxId],
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_MUST_HAVE_MAILBOX' });

    expect(await h.inspect.stateVersion()).toBe(beforeState);
    expect(await h.inspect.changes()).toEqual(beforeChanges);
    expectTypeOf<UpdateEmailInput>().not.toHaveProperty('subject');
    expectTypeOf<UpdateEmailInput>().not.toHaveProperty('blobId');
  });

  it.each([
    {
      patch: (h: Awaited<ReturnType<typeof createSeededEmailHarness>>) => ({
        addMailboxIds: [h.archiveId],
        removeMailboxIds: [h.archiveId],
      }),
    },
    {
      patch: () => ({
        addKeywords: ['$SEEN'],
        removeKeywords: ['$seen'],
      }),
    },
  ])('rejects overlapping normalized add/remove sets', async ({ patch }) => {
    const h = await createSeededEmailHarness();
    const beforeState = await h.inspect.stateVersion();

    await expect(
      updateEmail(h.deps, {
        accountId: h.accountId,
        emailId: h.emailId,
        ...patch(h),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATCH' });

    expect(await h.inspect.stateVersion()).toBe(beforeState);
  });

  it('does not allocate state or Changes for an effective no-op', async () => {
    const h = await createSeededEmailHarness({ keywords: ['$seen'] });
    const beforeState = await h.inspect.stateVersion();
    const beforeChanges = await h.inspect.changes();

    const result = await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [h.inboxId],
      addKeywords: ['$SEEN'],
      removeKeywords: ['$flagged'],
    });

    expect(result.stateVersion).toBe(beforeState);
    expect(await h.inspect.stateVersion()).toBe(beforeState);
    expect(await h.inspect.changes()).toEqual(beforeChanges);
  });

  it('rejects Mailboxes owned by another account', async () => {
    const h = await createSeededEmailHarness();
    const other = await createMailAccount(h.deps, {
      userId: 'other-user',
      connectionId: 'other-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const otherInbox = (await h.deps.inspect.mailboxes(other.id)).find(
      ({ role }) => role === 'inbox',
    )!;
    const beforeState = await h.inspect.stateVersion();

    await expect(
      updateEmail(h.deps, {
        accountId: h.accountId,
        emailId: h.emailId,
        addMailboxIds: [otherInbox.id],
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });

    expect(await h.inspect.stateVersion()).toBe(beforeState);
  });

  it('reserves $draft and Drafts membership for Draft lifecycle commands', async () => {
    const h = await createSeededEmailHarness();
    const drafts = (await h.deps.inspect.mailboxes(h.accountId)).find(
      ({ role }) => role === 'drafts',
    )!;
    const identity = await createIdentity(h.deps, {
      accountId: h.accountId,
      name: 'Draft owner',
      email: 'draft-owner@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const draft = await createDraft(h.deps, {
      accountId: h.accountId,
      identityId: identity.id,
      replyToEmailId: null,
      to: [{ email: 'recipient@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Protected Draft',
      textBody: 'Draft body',
      htmlBody: '',
      attachmentBlobIds: [],
    });

    for (const runInvalidPatch of [
      () =>
        updateEmail(h.deps, {
          accountId: h.accountId,
          emailId: draft.id,
          removeKeywords: ['$draft'],
        }),
      () =>
        updateEmail(h.deps, {
          accountId: h.accountId,
          emailId: draft.id,
          removeMailboxIds: [drafts.id],
          addMailboxIds: [h.archiveId],
        }),
      () =>
        updateEmail(h.deps, {
          accountId: h.accountId,
          emailId: h.emailId,
          addKeywords: ['$draft'],
        }),
      () =>
        updateEmail(h.deps, {
          accountId: h.accountId,
          emailId: h.emailId,
          addMailboxIds: [drafts.id],
        }),
    ]) {
      const beforeState = await h.inspect.stateVersion();
      const beforeChanges = await h.inspect.changes();
      await expect(runInvalidPatch()).rejects.toMatchObject({ code: 'INVALID_PATCH' });
      expect(await h.inspect.stateVersion()).toBe(beforeState);
      expect(await h.inspect.changes()).toEqual(beforeChanges);
    }
  });
});
