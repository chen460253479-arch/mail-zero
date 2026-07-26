import { createDraft, createIdentity, createSubmission } from '@zero/mail-core';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { outboundDelivery, sendAttempt } from '../../src/db/schema';
import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

const dialect = new PgDialect();

describe('PostgreSQL outbound spool schema', () => {
  it('declares the provider-neutral authoritative Delivery queue in integration', () => {
    const config = getTableConfig(outboundDelivery);

    expect(config.schema).toBe('integration');
    expect(config.name).toBe('outbound_delivery');
    expect(config.columns.map(({ name }) => name)).toEqual([
      'id',
      'mail_account_id',
      'submission_id',
      'connection_id',
      'status',
      'available_at',
      'lease_owner',
      'lease_token',
      'lease_expires_at',
      'attempt_count',
      'reconciliation_count',
      'uncertain_since',
      'last_error_kind',
      'last_error_code',
      'last_error_message',
      'created_at',
      'updated_at',
      'completed_at',
    ]);
    expect(config.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'outbound_delivery_status_chk',
        'outbound_delivery_counters_chk',
        'outbound_delivery_lease_lifecycle_chk',
        'outbound_delivery_uncertain_lifecycle_chk',
        'outbound_delivery_completed_lifecycle_chk',
      ]),
    );
    expect(config.uniqueConstraints.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'outbound_delivery_id_account_uidx',
        'outbound_delivery_account_submission_uidx',
        'outbound_delivery_id_account_submission_uidx',
      ]),
    );
    expect(config.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'outbound_delivery_account_connection_fk',
        'outbound_delivery_submission_account_fk',
      ]),
    );
    expect(config.indexes.map(({ config: index }) => index.name)).toEqual(
      expect.arrayContaining(['outbound_delivery_due_idx', 'outbound_delivery_expired_lease_idx']),
    );
    for (const name of ['outbound_delivery_due_idx', 'outbound_delivery_expired_lease_idx']) {
      expect(
        config.indexes.find(({ config: index }) => index.name === name)?.config.where,
      ).toBeDefined();
    }
  });

  it('stores send and reconciliation Attempts separately from Mail Core Submission state', () => {
    const config = getTableConfig(sendAttempt);

    expect(config.schema).toBe('integration');
    expect(config.name).toBe('send_attempt');
    expect(config.columns.map(({ name }) => name)).toEqual([
      'id',
      'mail_account_id',
      'delivery_id',
      'submission_id',
      'attempt_number',
      'kind',
      'lease_token',
      'started_at',
      'finished_at',
      'outcome',
      'provider_code',
      'safe_response',
      'retry_at',
      'remote_message_id',
      'remote_thread_id',
    ]);
    expect(config.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'send_attempt_kind_chk',
        'send_attempt_outcome_chk',
        'send_attempt_number_positive_chk',
        'send_attempt_lifecycle_chk',
      ]),
    );
    expect(config.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'send_attempt_delivery_account_submission_fk',
        'send_attempt_submission_account_fk',
      ]),
    );
    const openSend = config.indexes.find(
      ({ config: index }) => index.name === 'send_attempt_open_delivery_uidx',
    );
    expect(openSend?.config.unique).toBe(true);
    expect(dialect.sqlToQuery(openSend!.config.where!).sql).toContain(
      `"integration"."send_attempt"."finished_at" IS NULL`,
    );
    expect(dialect.sqlToQuery(openSend!.config.where!).sql).toContain(
      `"integration"."send_attempt"."kind" = 'send'`,
    );
  });

  it('removes worker scheduling columns from the business Submission table', async () => {
    const { emailSubmission } = await import('../../src/db/schema');

    expect(getTableConfig(emailSubmission).columns.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(['attempt_count', 'next_attempt_at']),
    );
  });

  it('enforces account, lease, counter, delivery, and open-attempt integrity in PostgreSQL', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const primary = await createPostgresMailTestHarness(db, unitOfWork, 'outbound-primary');
      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'outbound-foreign');
      const now = primary.dependencies.clock.now();

      const createQueuedSubmission = async (
        harness: Awaited<ReturnType<typeof createPostgresMailTestHarness>>,
        suffix: string,
      ) => {
        const identity = await createIdentity(harness.dependencies, {
          accountId: harness.accountId,
          name: `${suffix} Sender`,
          email: `${suffix}@example.test`,
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

      const primarySubmission = await createQueuedSubmission(primary, 'outbound-primary');
      const secondSubmission = await createQueuedSubmission(primary, 'outbound-primary-second');
      const foreignSubmission = await createQueuedSubmission(foreign, 'outbound-foreign');
      const delivery = {
        id: 'outbound-delivery-1',
        mailAccountId: primary.accountId,
        submissionId: primarySubmission.id,
        connectionId: 'postgres-connection-outbound-primary',
        status: 'ready' as const,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      };

      await expect(
        db.insert(outboundDelivery).values({
          ...delivery,
          id: 'outbound-cross-account',
          submissionId: foreignSubmission.id,
        }),
      ).rejects.toBeDefined();
      await expect(
        db.insert(outboundDelivery).values({
          ...delivery,
          id: 'outbound-invalid-lease',
          submissionId: secondSubmission.id,
          status: 'leased',
          leaseOwner: 'worker-1',
        }),
      ).rejects.toBeDefined();
      await expect(
        db.insert(outboundDelivery).values({
          ...delivery,
          id: 'outbound-negative-counter',
          submissionId: secondSubmission.id,
          attemptCount: -1,
        }),
      ).rejects.toBeDefined();

      await db.insert(outboundDelivery).values(delivery);
      await expect(
        db.insert(outboundDelivery).values({
          ...delivery,
          id: 'outbound-duplicate-submission',
        }),
      ).rejects.toBeDefined();

      const leasedDelivery = {
        ...delivery,
        id: 'outbound-delivery-2',
        submissionId: secondSubmission.id,
        status: 'leased' as const,
        leaseOwner: 'worker-1',
        leaseToken: 'lease-1',
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      };
      await db.insert(outboundDelivery).values(leasedDelivery);
      const firstAttempt = {
        id: 'send-attempt-1',
        mailAccountId: primary.accountId,
        deliveryId: leasedDelivery.id,
        submissionId: leasedDelivery.submissionId,
        attemptNumber: 1,
        kind: 'send' as const,
        leaseToken: leasedDelivery.leaseToken,
        startedAt: now,
      };
      await db.insert(sendAttempt).values(firstAttempt);
      await expect(
        db.insert(sendAttempt).values({
          ...firstAttempt,
          id: 'send-attempt-duplicate-number',
          finishedAt: now,
          outcome: 'transient_failure',
        }),
      ).rejects.toBeDefined();
      await expect(
        db.insert(sendAttempt).values({
          ...firstAttempt,
          id: 'send-attempt-second-open',
          attemptNumber: 2,
        }),
      ).rejects.toBeDefined();
    }));
});
