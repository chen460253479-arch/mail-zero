import { createDraft, createIdentity } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createPostgresMailTestHarness } from '../../../../tests/mail-core/helpers/harness';
import { withMailTestDatabase } from '../../../../tests/mail-core/helpers/database';
import { PostgresMailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { MailOutboundTransaction } from '../postgres/unit-of-work';
import { setOutboundSubmissions } from './set-submissions';
import { enqueueSubmission } from './enqueue-submission';
import { connection } from '../../../db/schema';

describe('enqueueSubmission', () => {
  it('atomically creates one idempotent Submission and Delivery', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(db, {
        nextId: () => `enqueue-infra-${++sequence}`,
        nextLeaseToken: () => `enqueue-lease-${++sequence}`,
      });
      const harness = await createPostgresMailTestHarness(db, unitOfWork.mailUnitOfWork, 'enqueue');
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Enqueue Sender',
        email: 'enqueue@example.test',
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
        subject: 'Enqueue',
        textBody: 'Enqueue body',
        htmlBody: '',
        attachmentBlobIds: [],
      });
      const wakeup = { enqueue: vi.fn() };
      const dependencies = {
        unitOfWork,
        mailCoreDependencies: harness.dependencies,
        clock: harness.dependencies.clock,
        nextId: () => `delivery-${++sequence}`,
        wakeup,
      };
      const input = {
        accountId: harness.accountId,
        emailId: draft.id,
        identityId: identity.id,
        idempotencyKey: 'enqueue-idempotency',
        sendAt: null,
      };

      const first = await enqueueSubmission(input, dependencies);
      const second = await enqueueSubmission(input, dependencies);

      expect(second.submission.id).toBe(first.submission.id);
      expect(second.delivery.id).toBe(first.delivery.id);
      expect(wakeup.enqueue).toHaveBeenCalledWith({
        type: 'deliver',
        deliveryId: first.delivery.id,
      });

      const account = await unitOfWork.mailUnitOfWork.run((tx) =>
        tx.accounts.findById(harness.accountId),
      );
      await db
        .update(connection)
        .set({ status: 'disconnecting' })
        .where(eq(connection.id, account!.connectionId));

      await expect(
        enqueueSubmission(
          {
            ...input,
            idempotencyKey: 'enqueue-while-disconnecting',
          },
          dependencies,
        ),
      ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
      await unitOfWork.run(async (tx) => {
        expect(
          await tx.mail.submissions.findByIdempotencyKey(
            harness.accountId,
            'enqueue-while-disconnecting',
          ),
        ).toBeNull();
        expect(
          await tx.outbound.claimById({
            deliveryId: first.delivery.id,
            owner: 'blocked-worker',
            leaseForMs: 60_000,
            attemptKind: 'send',
            now: harness.dependencies.clock.now(),
          }),
        ).toBeNull();
      });
    }));

  it('rolls back Submission and Change when Delivery insertion fails', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const base = new PostgresMailOutboundUnitOfWork(db, {
        nextId: () => `rollback-infra-${++sequence}`,
        nextLeaseToken: () => `rollback-lease-${++sequence}`,
      });
      const harness = await createPostgresMailTestHarness(
        db,
        base.mailUnitOfWork,
        'enqueue-rollback',
      );
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Rollback Sender',
        email: 'rollback@example.test',
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
        subject: 'Rollback',
        textBody: 'Rollback body',
        htmlBody: '',
        attachmentBlobIds: [],
      });
      const failingUnitOfWork = {
        run: <Result>(operation: (tx: MailOutboundTransaction) => Promise<Result>) =>
          base.run((tx) =>
            operation({
              ...tx,
              outbound: {
                ...tx.outbound,
                insert: async () => {
                  throw new Error('injected delivery failure');
                },
              },
            }),
          ),
      };
      const before = await base.mailUnitOfWork.run((tx) => tx.accounts.findById(harness.accountId));

      await expect(
        enqueueSubmission(
          {
            accountId: harness.accountId,
            emailId: draft.id,
            identityId: identity.id,
            idempotencyKey: 'enqueue-rollback',
            sendAt: null,
          },
          {
            unitOfWork: failingUnitOfWork,
            mailCoreDependencies: harness.dependencies,
            clock: harness.dependencies.clock,
            nextId: () => 'delivery-rollback',
            wakeup: { enqueue: vi.fn() },
          } as never,
        ),
      ).rejects.toThrow('injected delivery failure');
      await base.mailUnitOfWork.run(async (tx) => {
        expect(
          await tx.submissions.findByIdempotencyKey(harness.accountId, 'enqueue-rollback'),
        ).toBeNull();
        expect(await tx.accounts.findById(harness.accountId)).toMatchObject({
          stateVersion: before!.stateVersion,
        });
      });
    }));

  it('checks ifInState under the same account lock and transaction as enqueue', () =>
    withMailTestDatabase(async ({ db }) => {
      let sequence = 0;
      const unitOfWork = new PostgresMailOutboundUnitOfWork(db, {
        nextId: () => `state-infra-${++sequence}`,
        nextLeaseToken: () => `state-lease-${++sequence}`,
      });
      const harness = await createPostgresMailTestHarness(
        db,
        unitOfWork.mailUnitOfWork,
        'enqueue-state',
      );
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'State Sender',
        email: 'state@example.test',
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
        subject: 'State',
        textBody: 'State body',
        htmlBody: '',
        attachmentBlobIds: [],
      });
      const currentState = await unitOfWork.mailUnitOfWork.run(async (tx) =>
        (await tx.accounts.findById(harness.accountId))!.stateVersion.toString(),
      );
      const wakeup = { enqueue: vi.fn() };

      await expect(
        setOutboundSubmissions(
          {
            accountId: harness.accountId,
            ifInState: (BigInt(currentState) - 1n).toString(),
            create: {
              clientRequest: {
                emailId: draft.id,
                identityId: identity.id,
                idempotencyKey: 'enqueue-stale-state',
                sendAt: null,
              },
            },
            destroy: [],
          },
          {
            unitOfWork,
            mailCoreDependencies: harness.dependencies,
            clock: harness.dependencies.clock,
            nextId: () => `state-delivery-${++sequence}`,
            wakeup,
          },
        ),
      ).rejects.toMatchObject({ code: 'STATE_MISMATCH' });

      await unitOfWork.run(async (tx) => {
        expect(
          await tx.mail.submissions.findByIdempotencyKey(harness.accountId, 'enqueue-stale-state'),
        ).toBeNull();
      });
      expect(wakeup.enqueue).not.toHaveBeenCalled();
    }));
});
