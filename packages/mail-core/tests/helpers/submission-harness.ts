import {
  cancelSubmission,
  createDraft,
  createIdentity,
  createSubmission,
  transitionSubmission,
  type EmailId,
  type EmailSubmissionId,
  type IdentityId,
  type MailAccountId,
  type SubmissionStatus,
} from '../../src';
import { createDraftHarness } from './draft-harness';

export async function createSubmissionHarness(
  options: {
    initialStatus?: SubmissionStatus;
    now?: Date;
  } = {},
) {
  const base = await createDraftHarness();
  if (options.now !== undefined) {
    base.deps.clock.set(options.now);
  }
  const first = await createDraft(base.deps, base.content);
  const second = await createDraft(base.deps, {
    ...base.content,
    subject: 'Other draft',
  });
  let submissionId: EmailSubmissionId | undefined;

  if (options.initialStatus !== undefined) {
    const scheduled = options.initialStatus === 'scheduled';
    const created = await createSubmission(base.deps, {
      accountId: base.accountId,
      emailId: first.id,
      identityId: base.identityId,
      idempotencyKey: `fixture-${options.initialStatus}`,
      sendAt: scheduled ? new Date(base.deps.clock.now().getTime() + 60_000) : null,
    });
    submissionId = created.id;
    if (options.initialStatus === 'queued' || options.initialStatus === 'scheduled') {
      return buildResult(base, first.id, second.id, submissionId);
    }
    if (options.initialStatus === 'canceled') {
      await cancelSubmission(base.deps, {
        accountId: base.accountId,
        submissionId,
      });
      return buildResult(base, first.id, second.id, submissionId);
    }
    if (options.initialStatus === 'sent') {
      await transitionSubmission(base.deps, {
        accountId: base.accountId,
        submissionId,
        to: 'sent',
        outcome: { type: 'sent' },
      });
    } else if (options.initialStatus === 'failed') {
      await transitionSubmission(base.deps, {
        accountId: base.accountId,
        submissionId,
        to: 'failed',
        outcome: { type: 'failure', retryable: false },
      });
    }
  }

  return buildResult(base, first.id, second.id, submissionId);
}

const buildResult = (
  base: Awaited<ReturnType<typeof createDraftHarness>>,
  draftId: EmailId,
  otherDraftId: EmailId,
  submissionId: EmailSubmissionId | undefined,
) => ({
  ...base,
  draftId,
  otherDraftId,
  submissionId,
  createIdentity: async (suffix: string, accountId = base.accountId) =>
    createIdentity(base.deps, {
      accountId,
      name: `Sender ${suffix}`,
      email: `sender-${suffix}@example.test`,
      replyTo: null,
      makeDefault: false,
    }),
  inspect: {
    ...base.inspect,
    submissions: (accountId: MailAccountId = base.accountId) =>
      base.deps.inspect.submissions(accountId),
    submission: (id: EmailSubmissionId) => base.deps.inspect.submission(id),
  },
  mutate: {
    email: (id: EmailId, patch: Record<string, unknown>, accountId = base.accountId) =>
      base.deps.unitOfWork.run((tx) => tx.emails.update(accountId, id, patch)),
    identityId: (id: IdentityId) => id,
  },
});
