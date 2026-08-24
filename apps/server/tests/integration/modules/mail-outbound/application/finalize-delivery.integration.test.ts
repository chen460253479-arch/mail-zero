import { createDraft, createIdentity } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';

import { createPostgresMailNotificationRepository } from '../../../../../src/modules/mail-notifications/postgres/repository';
import { PostgresMailOutboundUnitOfWork } from '../../../../../src/modules/mail-outbound/postgres/unit-of-work';
import { finalizeFailedDelivery } from '../../../../../src/modules/mail-outbound/application/finalize-failed';
import { finalizeAcceptedDelivery } from '../../../../../src/modules/mail-outbound/application/finalize-sent';
import type { MailOutboundTransaction } from '../../../../../src/modules/mail-outbound/postgres/unit-of-work';
import { cancelPendingDelivery } from '../../../../../src/modules/mail-outbound/application/cancel-delivery';
import { enqueueSubmission } from '../../../../../src/modules/mail-outbound/application/enqueue-submission';
import { externalMailSubmission } from '../../../../../src/modules/external-integration/postgres/schema';
import { createPostgresMailTestHarness } from '../../../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../../../helpers/mail-core/database';
import type { DB } from '../../../../../src/db';

const linkExternalSubmission = async (
  db: DB,
  input: {
    id: string;
    userId: string;
    accountId: string;
    connectionId: string;
    identityId: string;
    emailId: string;
    submissionId: string;
    now: Date;
    linked?: boolean;
  },
) =>
  await db.insert(externalMailSubmission).values({
    id: input.id,
    userId: input.userId,
    mailAccountId: input.accountId,
    internalConnectionId: input.connectionId,
    identityId: input.identityId,
    externalUserId: `${input.id}-user`,
    externalConnectionId: `${input.id}-connection`,
    idempotencyKey: `${input.id}-idempotency`,
    requestFingerprint: 'a'.repeat(64),
    payload: {
      replyToMessageId: null,
      to: [{ email: 'recipient@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Terminal status notification',
      textBody: 'Body',
      htmlBody: '',
      attachments: [],
      sendAt: null,
    },
    status: input.linked === false ? 'preparing' : 'submitted',
    emailId: input.emailId,
    submissionId: input.linked === false ? null : input.submissionId,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: input.now,
    updatedAt: input.now,
  });

describe('composite outbound finalization', () => {
  it('atomically marks Provider acceptance, local Draft-to-Sent, and Delivery completed', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(
        db,
        {
          nextId: () => `finalize-infra-${++sequence}`,
          nextLeaseToken: () => `finalize-lease-${++sequence}`,
        },
        { notificationsEnabled: true },
      );
      const harness = await createPostgresMailTestHarness(
        db,
        unitOfWork.mailUnitOfWork,
        'finalize',
      );
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Finalize Sender',
        email: 'finalize@example.test',
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
        subject: 'Finalize',
        textBody: 'Finalize body',
        htmlBody: '',
        attachments: [],
      });
      const queued = await enqueueSubmission(
        {
          accountId: harness.accountId,
          emailId: draft.id,
          identityId: identity.id,
          idempotencyKey: 'external-mail:external-finalize-success',
          sendAt: null,
        },
        {
          unitOfWork,
          mailCoreDependencies: harness.dependencies,
          clock: harness.dependencies.clock,
          nextId: () => `finalize-delivery-${++sequence}`,
          wakeup: { enqueue: vi.fn() },
        },
      );
      await linkExternalSubmission(db, {
        id: 'external-finalize-success',
        userId: harness.userId,
        accountId: harness.accountId,
        connectionId: 'postgres-connection-finalize',
        identityId: identity.id,
        emailId: draft.id,
        submissionId: queued.submission.id,
        now: harness.dependencies.clock.now(),
        linked: false,
      });
      const claimed = await unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: queued.delivery.id,
          owner: 'finalize-worker',
          leaseForMs: 60_000,
          attemptKind: 'send',
          now: harness.dependencies.clock.now(),
        }),
      );
      const acceptedAt = new Date('2026-01-01T00:00:05.000Z');
      const failingUnitOfWork = {
        run: <Result>(operation: (tx: MailOutboundTransaction) => Promise<Result>) =>
          unitOfWork.run((tx) =>
            operation({
              ...tx,
              outbound: {
                ...tx.outbound,
                markCompleted: async () => {
                  throw new Error('injected completion failure');
                },
              },
            }),
          ),
      };
      await expect(
        finalizeAcceptedDelivery(
          {
            claimed: claimed!,
            provider: 'gmail',
            accepted: {
              remoteMessageId: 'gmail-message',
              remoteThreadId: 'gmail-thread',
              acceptedAt,
              providerCode: '200',
              safeResponse: 'accepted',
            },
          },
          {
            unitOfWork: failingUnitOfWork,
            mailCoreDependencies: harness.dependencies,
          } as never,
        ),
      ).rejects.toThrow('injected completion failure');
      await unitOfWork.run(async (tx) => {
        expect(await tx.outbound.findById(queued.delivery.id)).toMatchObject({ status: 'leased' });
        expect(
          await tx.mail.submissions.findById(harness.accountId, queued.submission.id),
        ).toMatchObject({ status: 'queued' });
        expect(await tx.mail.emails.findById(harness.accountId, draft.id)).toMatchObject({
          lifecycle: 'draft',
        });
      });

      await finalizeAcceptedDelivery(
        {
          claimed: claimed!,
          provider: 'gmail',
          accepted: {
            remoteMessageId: 'gmail-message',
            remoteThreadId: 'gmail-thread',
            acceptedAt,
            providerCode: '200',
            safeResponse: 'accepted',
          },
        },
        {
          unitOfWork,
          mailCoreDependencies: harness.dependencies,
        },
      );

      await unitOfWork.run(async (tx) => {
        expect(await tx.outbound.findById(queued.delivery.id)).toMatchObject({
          status: 'completed',
          completedAt: acceptedAt,
          leaseToken: null,
        });
        expect(
          await tx.mail.submissions.findById(harness.accountId, queued.submission.id),
        ).toMatchObject({
          status: 'sent',
          providerMessageId: 'gmail-message',
        });
        expect(await tx.mail.emails.findById(harness.accountId, draft.id)).toMatchObject({
          lifecycle: 'sent',
          sentAt: acceptedAt,
        });
      });
      const notificationRepository = createPostgresMailNotificationRepository(db, {
        enabled: true,
      });
      const successNotifications = await notificationRepository.claim({
        owner: 'success-notification-worker',
        now: new Date('2026-01-01T00:00:06.000Z'),
        limit: 10,
        leaseForMs: 60_000,
      });
      expect(successNotifications).toEqual([
        expect.objectContaining({
          eventType: 'submission_status',
          externalSubmissionId: 'external-finalize-success',
          messageId: draft.id,
          kind: 'sent',
          sentAt: acceptedAt,
        }),
      ]);
    }));

  it('keeps a local Email as Draft while atomically failing Submission and Delivery', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(
        db,
        {
          nextId: () => `failed-infra-${++sequence}`,
          nextLeaseToken: () => `failed-lease-${++sequence}`,
        },
        { notificationsEnabled: true },
      );
      const harness = await createPostgresMailTestHarness(db, unitOfWork.mailUnitOfWork, 'failed');
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Failed Sender',
        email: 'failed@example.test',
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
        subject: 'Failed',
        textBody: 'Failed body',
        htmlBody: '',
        attachments: [],
      });
      const queued = await enqueueSubmission(
        {
          accountId: harness.accountId,
          emailId: draft.id,
          identityId: identity.id,
          idempotencyKey: 'external-mail:external-finalize-failed',
          sendAt: null,
        },
        {
          unitOfWork,
          mailCoreDependencies: harness.dependencies,
          clock: harness.dependencies.clock,
          nextId: () => `failed-delivery-${++sequence}`,
          wakeup: { enqueue: vi.fn() },
        },
      );
      await linkExternalSubmission(db, {
        id: 'external-finalize-failed',
        userId: harness.userId,
        accountId: harness.accountId,
        connectionId: 'postgres-connection-failed',
        identityId: identity.id,
        emailId: draft.id,
        submissionId: queued.submission.id,
        now: harness.dependencies.clock.now(),
        linked: false,
      });
      const claimed = await unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: queued.delivery.id,
          owner: 'failed-worker',
          leaseForMs: 60_000,
          attemptKind: 'send',
          now: harness.dependencies.clock.now(),
        }),
      );

      await finalizeFailedDelivery(
        {
          claimed: claimed!,
          classification: {
            kind: 'policy_rejected',
            providerCode: 'POLICY',
            safeResponse: 'policy_rejected',
            retryAfter: null,
          },
          failedAt: harness.dependencies.clock.now(),
        },
        {
          unitOfWork,
          mailCoreDependencies: harness.dependencies,
        },
      );

      await unitOfWork.run(async (tx) => {
        expect(await tx.outbound.findById(queued.delivery.id)).toMatchObject({ status: 'failed' });
        expect(
          await tx.mail.submissions.findById(harness.accountId, queued.submission.id),
        ).toMatchObject({
          status: 'failed',
          lastErrorCode: 'POLICY',
        });
        expect(await tx.mail.emails.findById(harness.accountId, draft.id)).toMatchObject({
          lifecycle: 'draft',
        });
      });
      const failedNotifications = await createPostgresMailNotificationRepository(db, {
        enabled: true,
      }).claim({
        owner: 'failed-notification-worker',
        now: new Date('2026-01-01T00:00:01.000Z'),
        limit: 10,
        leaseForMs: 60_000,
      });
      expect(failedNotifications).toEqual([
        expect.objectContaining({
          eventType: 'submission_status',
          externalSubmissionId: 'external-finalize-failed',
          messageId: draft.id,
          kind: 'failed',
          errorCode: 'POLICY',
          errorMessage: 'policy_rejected',
        }),
      ]);
    }));

  it('atomically cancels a pending Submission and Delivery while retaining the Draft', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(db, {
        nextId: () => `cancel-infra-${++sequence}`,
        nextLeaseToken: () => `cancel-lease-${++sequence}`,
      });
      const harness = await createPostgresMailTestHarness(db, unitOfWork.mailUnitOfWork, 'cancel');
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Cancel Sender',
        email: 'cancel@example.test',
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
        subject: 'Cancel',
        textBody: 'Cancel body',
        htmlBody: '',
        attachments: [],
      });
      const queued = await enqueueSubmission(
        {
          accountId: harness.accountId,
          emailId: draft.id,
          identityId: identity.id,
          idempotencyKey: 'cancel-pending',
          sendAt: null,
        },
        {
          unitOfWork,
          mailCoreDependencies: harness.dependencies,
          clock: harness.dependencies.clock,
          nextId: () => `cancel-delivery-${++sequence}`,
          wakeup: { enqueue: vi.fn() },
        },
      );

      const canceled = await cancelPendingDelivery(
        {
          accountId: harness.accountId,
          submissionId: queued.submission.id,
        },
        {
          unitOfWork,
          mailCoreDependencies: harness.dependencies,
          clock: harness.dependencies.clock,
        },
      );

      expect(canceled).toMatchObject({
        submission: { status: 'canceled' },
        delivery: { status: 'canceled', leaseToken: null },
      });
      await unitOfWork.run(async (tx) => {
        expect(await tx.mail.emails.findById(harness.accountId, draft.id)).toMatchObject({
          lifecycle: 'draft',
        });
        await expect(
          tx.outbound.claimById({
            deliveryId: queued.delivery.id,
            owner: 'late-worker',
            leaseForMs: 60_000,
            attemptKind: 'send',
            now: harness.dependencies.clock.now(),
          }),
        ).resolves.toBeNull();
      });
    }));
});
