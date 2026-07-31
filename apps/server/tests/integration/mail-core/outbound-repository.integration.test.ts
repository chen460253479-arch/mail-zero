import { createDraft, createIdentity, createSubmission } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { PostgresMailOutboundUnitOfWork } from '../../../src/modules/mail-outbound/postgres/unit-of-work';
import { sendAttempt } from '../../../src/modules/mail-outbound/postgres/schema';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('PostgreSQL outbound repository', () => {
  it('atomically claims one due Delivery and creates one open Attempt', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(db, {
        nextId: () => `outbound-generated-${++sequence}`,
        nextLeaseToken: () => `lease-generated-${++sequence}`,
      });
      const callbackFailure = new Error('callback identity');
      await expect(unitOfWork.run(() => Promise.reject(callbackFailure))).rejects.toBe(
        callbackFailure,
      );
      const harness = await createPostgresMailTestHarness(db, unitOfWork.mailUnitOfWork);
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Outbound Sender',
        email: 'outbound@example.test',
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
        subject: 'Outbound',
        textBody: 'Outbound body',
        htmlBody: '',
        attachmentBlobIds: [],
      });
      const submission = await createSubmission(harness.dependencies, {
        accountId: harness.accountId,
        emailId: draft.id,
        identityId: identity.id,
        idempotencyKey: 'outbound-repository',
        sendAt: null,
      });
      const now = harness.dependencies.clock.now();
      await unitOfWork.run((tx) =>
        tx.outbound.insert({
          id: 'delivery-1',
          mailAccountId: harness.accountId,
          submissionId: submission.id,
          connectionId: 'postgres-connection-primary',
          status: 'ready',
          availableAt: now,
          now,
        }),
      );

      const [first, duplicate] = await Promise.all([
        unitOfWork.run((tx) =>
          tx.outbound.claimById({
            deliveryId: 'delivery-1',
            owner: 'worker-1',
            leaseForMs: 60_000,
            attemptKind: 'send',
            now,
          }),
        ),
        unitOfWork.run((tx) =>
          tx.outbound.claimById({
            deliveryId: 'delivery-1',
            owner: 'worker-2',
            leaseForMs: 60_000,
            attemptKind: 'send',
            now,
          }),
        ),
      ]);

      expect([first, duplicate].filter((result) => result !== null)).toHaveLength(1);
      expect(first ?? duplicate).toMatchObject({
        delivery: {
          id: 'delivery-1',
          status: 'leased',
          attemptCount: 1,
        },
        attemptKind: 'send',
        attemptNumber: 1,
      });
    }));

  it('orders due work and enforces token-scoped retry, recovery, and terminal states', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(db, {
        nextId: () => `outbound-lifecycle-${++sequence}`,
        nextLeaseToken: () => `lease-lifecycle-${++sequence}`,
      });
      const harness = await createPostgresMailTestHarness(
        db,
        unitOfWork.mailUnitOfWork,
        'outbound-lifecycle',
      );
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Lifecycle Sender',
        email: 'lifecycle@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const makeSubmission = async (suffix: string) => {
        const draft = await createDraft(harness.dependencies, {
          accountId: harness.accountId,
          identityId: identity.id,
          replyToEmailId: null,
          to: [{ email: 'recipient@example.test' }],
          cc: [],
          bcc: [],
          subject: suffix,
          textBody: suffix,
          htmlBody: '',
          attachmentBlobIds: [],
        });
        return createSubmission(harness.dependencies, {
          accountId: harness.accountId,
          emailId: draft.id,
          identityId: identity.id,
          idempotencyKey: suffix,
          sendAt: null,
        });
      };
      const firstSubmission = await makeSubmission('lifecycle-first');
      const secondSubmission = await makeSubmission('lifecycle-second');
      const now = harness.dependencies.clock.now();
      await unitOfWork.run(async (tx) => {
        await tx.outbound.insert({
          id: 'delivery-b',
          mailAccountId: harness.accountId,
          submissionId: secondSubmission.id,
          connectionId: 'postgres-connection-outbound-lifecycle',
          status: 'ready',
          availableAt: new Date(now.getTime() - 1_000),
          now,
        });
        await tx.outbound.insert({
          id: 'delivery-a',
          mailAccountId: harness.accountId,
          submissionId: firstSubmission.id,
          connectionId: 'postgres-connection-outbound-lifecycle',
          status: 'ready',
          availableAt: new Date(now.getTime() - 1_000),
          now,
        });
      });
      await expect(
        unitOfWork.run((tx) => tx.outbound.listDue({ now, limit: 10 })),
      ).resolves.toEqual(['delivery-a', 'delivery-b']);

      const firstClaim = await unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: 'delivery-a',
          owner: 'worker-1',
          leaseForMs: 60_000,
          attemptKind: 'send',
          now,
        }),
      );
      expect(firstClaim).not.toBeNull();
      const retryAt = new Date(now.getTime() + 30_000);
      await expect(
        unitOfWork.run((tx) =>
          tx.outbound.scheduleRetry({
            deliveryId: 'delivery-a',
            leaseToken: 'stale-token',
            retryAt,
            now,
            error: {
              kind: 'temporary_failure',
              providerCode: 'TEMP',
              safeResponse: 'temporary_failure',
              retryAfter: null,
            },
          }),
        ),
      ).rejects.toMatchObject({ code: 'MAIL_OUTBOUND_LEASE_LOST' });
      await unitOfWork.run((tx) =>
        tx.outbound.scheduleRetry({
          deliveryId: 'delivery-a',
          leaseToken: firstClaim!.delivery.leaseToken,
          retryAt,
          now,
          error: {
            kind: 'temporary_failure',
            providerCode: 'TEMP',
            safeResponse: 'temporary_failure',
            retryAfter: null,
          },
        }),
      );
      await expect(
        unitOfWork.run((tx) => tx.outbound.findById('delivery-a')),
      ).resolves.toMatchObject({
        status: 'retry_wait',
        availableAt: retryAt,
        leaseToken: null,
      });

      const secondClaim = await unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: 'delivery-a',
          owner: 'worker-2',
          leaseForMs: 60_000,
          attemptKind: 'send',
          now: retryAt,
        }),
      );
      expect(secondClaim!.delivery.leaseToken).not.toBe(firstClaim!.delivery.leaseToken);
      const expiredAt = new Date(secondClaim!.delivery.leaseExpiresAt.getTime() + 1);
      await expect(
        unitOfWork.run((tx) => tx.outbound.recoverExpiredLeases({ now: expiredAt, limit: 10 })),
      ).resolves.toEqual(['delivery-a']);
      await expect(
        unitOfWork.run((tx) => tx.outbound.findById('delivery-a')),
      ).resolves.toMatchObject({
        status: 'uncertain',
        leaseToken: null,
        uncertainSince: expiredAt,
      });
      await expect(
        unitOfWork.run((tx) => tx.outbound.listDue({ now: expiredAt, limit: 10 })),
      ).resolves.not.toContain('delivery-a');
      await expect(
        unitOfWork.run((tx) => tx.outbound.listDueUncertain({ now: expiredAt, limit: 10 })),
      ).resolves.toEqual(['delivery-a']);
      const attempts = await db
        .select()
        .from(sendAttempt)
        .where(eq(sendAttempt.deliveryId, 'delivery-a'));
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toMatchObject({
        outcome: 'uncertain',
        finishedAt: expiredAt,
      });
      const reconciliation = await unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: 'delivery-a',
          owner: 'reconciliation-worker',
          leaseForMs: 60_000,
          attemptKind: 'reconcile',
          now: expiredAt,
        }),
      );
      await unitOfWork.run((tx) =>
        tx.outbound.scheduleResend({
          deliveryId: 'delivery-a',
          leaseToken: reconciliation!.delivery.leaseToken,
          availableAt: expiredAt,
          now: expiredAt,
        }),
      );
      await expect(
        unitOfWork.run((tx) => tx.outbound.findById('delivery-a')),
      ).resolves.toMatchObject({
        status: 'ready',
        leaseToken: null,
      });

      const terminal = await unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: 'delivery-b',
          owner: 'worker-terminal',
          leaseForMs: 60_000,
          attemptKind: 'send',
          now,
        }),
      );
      await unitOfWork.run((tx) =>
        tx.outbound.markFailed({
          deliveryId: 'delivery-b',
          leaseToken: terminal!.delivery.leaseToken,
          now,
          error: {
            kind: 'policy_rejected',
            providerCode: 'POLICY',
            safeResponse: 'policy_rejected',
            retryAfter: null,
          },
        }),
      );
      await expect(
        unitOfWork.run((tx) =>
          tx.outbound.claimById({
            deliveryId: 'delivery-b',
            owner: 'worker-late',
            leaseForMs: 60_000,
            attemptKind: 'send',
            now,
          }),
        ),
      ).resolves.toBeNull();
    }));

  it('loads the frozen raw reference, envelope, route, Message-ID, and reply thread', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(db, {
        nextId: () => `outbound-snapshot-${++sequence}`,
        nextLeaseToken: () => `lease-snapshot-${++sequence}`,
      });
      const harness = await createPostgresMailTestHarness(
        db,
        unitOfWork.mailUnitOfWork,
        'outbound-snapshot',
      );
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Snapshot Sender',
        email: 'snapshot@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const source = await createDraft(harness.dependencies, {
        accountId: harness.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'snapshot@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Source',
        textBody: 'Source',
        htmlBody: '',
        attachmentBlobIds: [],
      });
      const now = harness.dependencies.clock.now();
      await unitOfWork.mailUnitOfWork.run((tx) =>
        tx.emails.linkRemote({
          accountId: harness.accountId,
          provider: 'gmail',
          remoteEmailId: 'gmail-source',
          remoteThreadId: 'gmail-thread',
          emailId: source.id,
          contentFingerprint: 'source-fingerprint',
          firstSeenAt: now,
          lastSeenAt: now,
        }),
      );
      const reply = await createDraft(harness.dependencies, {
        accountId: harness.accountId,
        identityId: identity.id,
        replyToEmailId: source.id,
        to: [{ email: 'to@example.test' }, { email: 'second@example.test' }],
        cc: [{ email: 'cc@example.test' }],
        bcc: [{ email: 'bcc@example.test' }],
        subject: 'Reply',
        textBody: 'Reply body',
        htmlBody: '',
        attachmentBlobIds: [],
      });
      const submission = await createSubmission(harness.dependencies, {
        accountId: harness.accountId,
        emailId: reply.id,
        identityId: identity.id,
        idempotencyKey: 'outbound-snapshot',
        sendAt: null,
      });
      await unitOfWork.run(async (tx) => {
        await tx.outbound.insert({
          id: 'delivery-snapshot',
          mailAccountId: harness.accountId,
          submissionId: submission.id,
          connectionId: 'postgres-connection-outbound-snapshot',
          status: 'ready',
          availableAt: now,
          now,
        });
      });
      const claimed = await unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: 'delivery-snapshot',
          owner: 'snapshot-worker',
          leaseForMs: 60_000,
          attemptKind: 'send',
          now,
        }),
      );
      const snapshot = await unitOfWork.run((tx) =>
        tx.outbound.loadMessage({
          deliveryId: 'delivery-snapshot',
          leaseToken: claimed!.delivery.leaseToken,
        }),
      );
      const persistedReply = await unitOfWork.mailUnitOfWork.run((tx) =>
        tx.emails.findById(harness.accountId, reply.id),
      );

      expect(snapshot).toMatchObject({
        channelId: 'gmail',
        messageId: persistedReply!.messageId,
        envelope: {
          from: identity.email,
          to: ['to@example.test', 'second@example.test'],
          cc: ['cc@example.test'],
          bcc: ['bcc@example.test'],
        },
        raw: {
          blobId: submission.rawBlobId,
          objectKey: submission.rawObjectKey,
          sha256: submission.rawSha256,
          sizeBytes: submission.rawSizeBytes,
          contentType: 'message/rfc822',
        },
        remoteThreadReferences: [{ provider: 'gmail', remoteThreadId: 'gmail-thread' }],
      });
    }));
});
