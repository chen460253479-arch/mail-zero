import {
  cancelSubmission,
  createDraft,
  createIdentity,
  createMailCore,
  createSubmission,
  destroyIdentity,
  finalizeSubmissionSent,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('PostgreSQL Submission integration', () => {
  it('enforces idempotency, Identity use, and atomic sent finalization', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork);
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Submission Sender',
        email: 'submission-sender@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const draft = await createDraft(harness.dependencies, {
        accountId: harness.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Submit me',
        textBody: 'Submission body.',
        htmlBody: '',
        attachments: [],
      });
      const request = {
        accountId: harness.accountId,
        emailId: draft.id,
        identityId: identity.id,
        idempotencyKey: 'submission-idempotency-1',
        sendAt: null,
      };
      const first = await createSubmission(harness.dependencies, request);
      await expect(createSubmission(harness.dependencies, request)).resolves.toEqual(first);
      await expect(
        createSubmission(harness.dependencies, {
          ...request,
          sendAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(
        destroyIdentity(harness.dependencies, {
          accountId: harness.accountId,
          identityId: identity.id,
        }),
      ).rejects.toMatchObject({ code: 'IDENTITY_IN_USE' });

      const completions = await Promise.allSettled([
        finalizeSubmissionSent(harness.dependencies, {
          accountId: harness.accountId,
          submissionId: first.id,
          provider: 'gmail',
          remoteMessageId: 'provider-message-1',
          remoteThreadId: 'provider-thread-1',
          acceptedAt: harness.dependencies.clock.now(),
        }),
        finalizeSubmissionSent(harness.dependencies, {
          accountId: harness.accountId,
          submissionId: first.id,
          provider: 'gmail',
          remoteMessageId: 'provider-message-2',
          remoteThreadId: 'provider-thread-2',
          acceptedAt: harness.dependencies.clock.now(),
        }),
      ]);
      expect(completions.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(completions.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: { code: 'INVALID_SUBMISSION_TRANSITION' },
      });
      const acceptedRemoteMessageId = completions.find((result) => result.status === 'fulfilled')!
        .value.submission.providerMessageId;
      const secondDraft = await createDraft(harness.dependencies, {
        accountId: harness.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'second-recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Submit me second',
        textBody: 'Second submission body.',
        htmlBody: '',
        attachments: [],
      });
      const secondSubmission = await createSubmission(harness.dependencies, {
        accountId: harness.accountId,
        emailId: secondDraft.id,
        identityId: identity.id,
        idempotencyKey: 'submission-idempotency-2',
        sendAt: null,
      });
      const core = createMailCore(harness.dependencies);
      const firstPage = await core.querySubmissions({
        accountId: harness.accountId,
        limit: 1,
        cursor: null,
      });
      expect(firstPage.submissions.map(({ id }) => id)).toEqual([first.id]);
      expect(firstPage.nextCursor).not.toBeNull();
      await expect(
        core.querySubmissions({
          accountId: harness.accountId,
          limit: 1,
          cursor: firstPage.nextCursor,
        }),
      ).resolves.toEqual({
        submissions: [secondSubmission],
        nextCursor: null,
      });
      await expect(
        core.querySubmissions({
          accountId: harness.accountId,
          status: 'queued',
          limit: 20,
          cursor: null,
        }),
      ).resolves.toEqual({
        submissions: [secondSubmission],
        nextCursor: null,
      });
      await cancelSubmission(harness.dependencies, {
        accountId: harness.accountId,
        submissionId: secondSubmission.id,
      });
      await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Replacement Sender',
        email: 'replacement-sender@example.test',
        replyTo: null,
        makeDefault: false,
      });
      await expect(
        destroyIdentity(harness.dependencies, {
          accountId: harness.accountId,
          identityId: identity.id,
        }),
      ).resolves.toBeUndefined();
      await unitOfWork.run(async (tx) => {
        expect(await tx.identities.findById(harness.accountId, identity.id)).toBeNull();
        expect(await tx.submissions.findById(harness.accountId, first.id)).toMatchObject({
          identityId: identity.id,
          status: 'sent',
          providerMessageId: acceptedRemoteMessageId,
        });
      });
    }));
});
