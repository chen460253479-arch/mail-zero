import { describe, expect, it } from 'vitest';

import {
  createMailbox,
  createSubmission,
  finalizeSubmissionSent,
  updateDraft,
  updateEmail,
} from '../../src';
import { createSubmissionHarness } from '../helpers/submission-harness';

const createQueuedSubmission = async (
  h: Awaited<ReturnType<typeof createSubmissionHarness>>,
  idempotencyKey: string,
) =>
  createSubmission(h.deps, {
    accountId: h.accountId,
    emailId: h.draftId,
    identityId: h.identityId,
    idempotencyKey,
    sendAt: null,
  });

const findRemote = (
  h: Awaited<ReturnType<typeof createSubmissionHarness>>,
  remoteEmailId: string,
) =>
  h.deps.unitOfWork.run((tx) =>
    tx.emails.findByRemoteId({
      accountId: h.accountId,
      provider: 'gmail',
      remoteEmailId,
    }),
  );

describe('EmailSubmission sent finalization', () => {
  it('atomically turns the submitted Draft into a local Sent email and links the provider result', async () => {
    const h = await createSubmissionHarness();
    const submission = await createQueuedSubmission(h, 'gmail-accepted');
    const sentMailbox = (await h.deps.inspect.mailboxes(h.accountId)).find(
      ({ role }) => role === 'sent',
    )!;
    const acceptedAt = new Date('2026-01-01T00:00:30.000Z');

    const result = await finalizeSubmissionSent(h.deps, {
      accountId: h.accountId,
      submissionId: submission.id,
      provider: 'gmail',
      remoteMessageId: 'gmail-message-1',
      remoteThreadId: 'gmail-thread-1',
      acceptedAt,
    });

    expect(result.email).toMatchObject({
      id: h.draftId,
      lifecycle: 'sent',
      sentAt: acceptedAt,
      mailboxIds: [sentMailbox.id],
      keywords: ['$seen'],
    });
    expect(result.submission).toMatchObject({
      id: submission.id,
      status: 'sent',
      providerMessageId: 'gmail-message-1',
      sentAt: acceptedAt,
    });
    await expect(findRemote(h, 'gmail-message-1')).resolves.toMatchObject({
      emailId: h.draftId,
      remoteThreadId: 'gmail-thread-1',
    });
  });

  it('removes transient system mailboxes, preserves user labels, and records aggregate changes in one state', async () => {
    const h = await createSubmissionHarness();
    const project = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Project Zero',
      kind: 'label',
      role: null,
      parentId: null,
    });
    const mailboxes = await h.deps.inspect.mailboxes(h.accountId);
    const drafts = mailboxes.find(({ role }) => role === 'drafts')!;
    const outbox = mailboxes.find(({ role }) => role === 'outbox')!;
    const scheduled = mailboxes.find(({ role }) => role === 'scheduled')!;
    const sent = mailboxes.find(({ role }) => role === 'sent')!;
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.draftId,
      addMailboxIds: [project.id, outbox.id, scheduled.id],
    });
    const submission = await createQueuedSubmission(h, 'membership-finalization');

    const result = await finalizeSubmissionSent(h.deps, {
      accountId: h.accountId,
      submissionId: submission.id,
      provider: 'gmail',
      remoteMessageId: 'gmail-memberships',
      remoteThreadId: null,
      acceptedAt: new Date('2026-01-01T00:01:00.000Z'),
    });

    expect(result.email.mailboxIds).toHaveLength(2);
    expect(result.email.mailboxIds).toEqual(expect.arrayContaining([project.id, sent.id]));
    expect(result.email.mailboxIds).not.toContain(drafts.id);
    expect(result.email.mailboxIds).not.toContain(outbox.id);
    expect(result.email.mailboxIds).not.toContain(scheduled.id);
    expect(result.email.keywords).toEqual(['$seen']);
    await expect(h.inspect.mailbox(drafts.id)).resolves.toMatchObject({
      totalEmails: 1,
      unreadEmails: 1,
    });
    await expect(h.inspect.mailbox(sent.id)).resolves.toMatchObject({
      totalEmails: 1,
      unreadEmails: 0,
    });
    await expect(h.inspect.mailbox(project.id)).resolves.toMatchObject({
      totalEmails: 1,
      unreadEmails: 0,
    });
    await expect(h.inspect.thread(h.draftId)).resolves.toMatchObject({
      emailCount: 1,
      unreadCount: 0,
    });
    const finalChanges = (await h.inspect.changes()).filter(
      ({ stateVersion }) => stateVersion === result.stateVersion,
    );
    expect(finalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: 'email', entityId: h.draftId }),
        expect.objectContaining({
          collection: 'email_submission',
          entityId: submission.id,
        }),
        expect.objectContaining({ collection: 'thread' }),
        expect.objectContaining({ collection: 'mailbox', entityId: drafts.id }),
        expect.objectContaining({ collection: 'mailbox', entityId: outbox.id }),
        expect.objectContaining({ collection: 'mailbox', entityId: scheduled.id }),
        expect.objectContaining({ collection: 'mailbox', entityId: sent.id }),
        expect.objectContaining({ collection: 'mailbox', entityId: project.id }),
      ]),
    );
  });

  it('rejects finalization when the persisted Draft revision no longer matches the frozen submission', async () => {
    const h = await createSubmissionHarness();
    const submission = await createQueuedSubmission(h, 'stale-draft');
    await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: h.draftId,
      expectedRevision: 1,
      content: { ...h.content, subject: 'Revised after enqueue' },
    });
    const beforeEmail = await h.inspect.email(h.draftId);
    const beforeSubmission = await h.inspect.submission(submission.id);
    const beforeState = await h.inspect.stateVersion();

    await expect(
      finalizeSubmissionSent(h.deps, {
        accountId: h.accountId,
        submissionId: submission.id,
        provider: 'gmail',
        remoteMessageId: 'gmail-stale',
        remoteThreadId: null,
        acceptedAt: new Date('2026-01-01T00:01:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'DRAFT_REVISION_CONFLICT' });

    expect(await h.inspect.email(h.draftId)).toEqual(beforeEmail);
    expect(await h.inspect.submission(submission.id)).toEqual(beforeSubmission);
    expect(await h.inspect.stateVersion()).toBe(beforeState);
    expect(await findRemote(h, 'gmail-stale')).toBeNull();
  });

  it('treats an identical provider result as an idempotent replay without another state change', async () => {
    const h = await createSubmissionHarness();
    const submission = await createQueuedSubmission(h, 'idempotent-finalization');
    const input = {
      accountId: h.accountId,
      submissionId: submission.id,
      provider: 'gmail',
      remoteMessageId: 'gmail-idempotent',
      remoteThreadId: 'gmail-idempotent-thread',
      acceptedAt: new Date('2026-01-01T00:02:00.000Z'),
    } as const;
    const first = await finalizeSubmissionSent(h.deps, input);
    const changeCount = (await h.inspect.changes()).length;

    const replay = await finalizeSubmissionSent(h.deps, input);

    expect(replay).toEqual(first);
    expect(await h.inspect.stateVersion()).toBe(first.stateVersion);
    expect(await h.inspect.changes()).toHaveLength(changeCount);
  });

  it('rejects a different remote message result after the submission is already Sent', async () => {
    const h = await createSubmissionHarness();
    const submission = await createQueuedSubmission(h, 'conflicting-provider-result');
    await finalizeSubmissionSent(h.deps, {
      accountId: h.accountId,
      submissionId: submission.id,
      provider: 'gmail',
      remoteMessageId: 'gmail-original',
      remoteThreadId: 'gmail-thread',
      acceptedAt: new Date('2026-01-01T00:02:00.000Z'),
    });
    const beforeState = await h.inspect.stateVersion();

    await expect(
      finalizeSubmissionSent(h.deps, {
        accountId: h.accountId,
        submissionId: submission.id,
        provider: 'gmail',
        remoteMessageId: 'gmail-conflict',
        remoteThreadId: 'gmail-thread',
        acceptedAt: new Date('2026-01-01T00:02:01.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });

    expect(await h.inspect.stateVersion()).toBe(beforeState);
    expect(await findRemote(h, 'gmail-conflict')).toBeNull();
  });

  it('rejects a provider message ID that is already linked to another local Email', async () => {
    const h = await createSubmissionHarness();
    const submission = await createQueuedSubmission(h, 'remote-id-already-owned');
    await h.deps.unitOfWork.run((tx) =>
      tx.emails.linkRemote({
        accountId: h.accountId,
        provider: 'gmail',
        remoteEmailId: 'gmail-owned',
        remoteThreadId: 'gmail-other-thread',
        emailId: h.otherDraftId,
        contentFingerprint: 'other-content',
        firstSeenAt: h.deps.clock.now(),
        lastSeenAt: h.deps.clock.now(),
      }),
    );
    const beforeEmail = await h.inspect.email(h.draftId);
    const beforeState = await h.inspect.stateVersion();

    await expect(
      finalizeSubmissionSent(h.deps, {
        accountId: h.accountId,
        submissionId: submission.id,
        provider: 'gmail',
        remoteMessageId: 'gmail-owned',
        remoteThreadId: 'gmail-other-thread',
        acceptedAt: new Date('2026-01-01T00:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    expect(await h.inspect.email(h.draftId)).toEqual(beforeEmail);
    expect(await h.inspect.stateVersion()).toBe(beforeState);
  });

  it('rejects finalization when the persisted Draft has lost its stable RFC Message-ID', async () => {
    const h = await createSubmissionHarness();
    const submission = await createQueuedSubmission(h, 'missing-message-id');
    await h.mutate.email(h.draftId, { messageId: null });
    const beforeEmail = await h.inspect.email(h.draftId);
    const beforeState = await h.inspect.stateVersion();

    await expect(
      finalizeSubmissionSent(h.deps, {
        accountId: h.accountId,
        submissionId: submission.id,
        provider: 'gmail',
        remoteMessageId: 'gmail-without-message-id',
        remoteThreadId: null,
        acceptedAt: new Date('2026-01-01T00:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });

    expect(await h.inspect.email(h.draftId)).toEqual(beforeEmail);
    expect(await h.inspect.stateVersion()).toBe(beforeState);
    expect(await findRemote(h, 'gmail-without-message-id')).toBeNull();
  });

  it('rolls back Email, Submission, remote mapping, aggregates, and changes when a repository write fails', async () => {
    const h = await createSubmissionHarness();
    const submission = await createQueuedSubmission(h, 'rollback-finalization');
    const beforeEmail = await h.inspect.email(h.draftId);
    const beforeSubmission = await h.inspect.submission(submission.id);
    const beforeMailboxes = await h.deps.inspect.mailboxes(h.accountId);
    const beforeThread = await h.inspect.thread(h.draftId);
    const beforeChanges = await h.inspect.changes();
    const beforeState = await h.inspect.stateVersion();
    const failingDependencies = {
      ...h.deps,
      unitOfWork: {
        run: <Result>(
          operation: Parameters<typeof h.deps.unitOfWork.run<Result>>[0],
        ): Promise<Result> =>
          h.deps.unitOfWork.run(async (tx) => {
            tx.emails.linkRemote = async () => {
              throw new Error('injected remote mapping failure');
            };
            return operation(tx);
          }),
      },
    };

    await expect(
      finalizeSubmissionSent(failingDependencies, {
        accountId: h.accountId,
        submissionId: submission.id,
        provider: 'gmail',
        remoteMessageId: 'gmail-rollback',
        remoteThreadId: null,
        acceptedAt: new Date('2026-01-01T00:03:00.000Z'),
      }),
    ).rejects.toThrow('injected remote mapping failure');

    expect(await h.inspect.email(h.draftId)).toEqual(beforeEmail);
    expect(await h.inspect.submission(submission.id)).toEqual(beforeSubmission);
    expect(await h.deps.inspect.mailboxes(h.accountId)).toEqual(beforeMailboxes);
    expect(await h.inspect.thread(h.draftId)).toEqual(beforeThread);
    expect(await h.inspect.changes()).toEqual(beforeChanges);
    expect(await h.inspect.stateVersion()).toBe(beforeState);
    expect(await findRemote(h, 'gmail-rollback')).toBeNull();
  });
});
