import {
  createDraft,
  createIdentity,
  createSubmission,
  destroyIdentity,
  transitionSubmission,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

describe('PostgreSQL Submission integration', () => {
  it('enforces idempotency, Identity use, and exactly one open Attempt finalization', () =>
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
        attachmentBlobIds: [],
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

      await transitionSubmission(harness.dependencies, {
        accountId: harness.accountId,
        submissionId: first.id,
        to: 'sending',
        outcome: null,
      });
      const completions = await Promise.allSettled([
        transitionSubmission(harness.dependencies, {
          accountId: harness.accountId,
          submissionId: first.id,
          to: 'sent',
          outcome: {
            type: 'sent',
            providerMessageId: 'provider-message-1',
            safeResponse: 'accepted',
          },
        }),
        transitionSubmission(harness.dependencies, {
          accountId: harness.accountId,
          submissionId: first.id,
          to: 'sent',
          outcome: {
            type: 'sent',
            providerMessageId: 'provider-message-2',
            safeResponse: 'accepted',
          },
        }),
      ]);
      expect(completions.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(completions.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: { code: 'INVALID_SUBMISSION_TRANSITION' },
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
        });
        expect(await tx.submissions.listAttempts(harness.accountId, first.id)).toEqual([
          expect.objectContaining({
            attemptNumber: 1,
            outcome: 'sent',
            finishedAt: harness.dependencies.clock.now(),
          }),
        ]);
      });
    }));
});
