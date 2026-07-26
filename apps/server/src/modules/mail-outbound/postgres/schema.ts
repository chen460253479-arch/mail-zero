import {
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type {
  OutboundAttemptKind,
  OutboundAttemptOutcome,
  OutboundDeliveryStatus,
} from '../domain/delivery';
import { emailSubmission } from '../../mail/postgres/schema/submissions';
import type { OutboundErrorKind } from '../../../mail-channel/contracts';
import { createIntegrationTable } from '../../mail/postgres/table';
import { mailAccount } from '../../mail/postgres/schema/accounts';

export const outboundDelivery = createIntegrationTable(
  'outbound_delivery',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id').notNull(),
    submissionId: text('submission_id').notNull(),
    connectionId: text('connection_id').notNull(),
    status: text('status').$type<OutboundDeliveryStatus>().notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    reconciliationCount: integer('reconciliation_count').notNull().default(0),
    uncertainSince: timestamp('uncertain_since', { withTimezone: true }),
    lastErrorKind: text('last_error_kind').$type<OutboundErrorKind>(),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'outbound_delivery_status_chk',
      sql`${t.status} IN ('scheduled', 'ready', 'leased', 'retry_wait', 'uncertain', 'completed', 'failed', 'canceled')`,
    ),
    check(
      'outbound_delivery_counters_chk',
      sql`${t.attemptCount} >= 0 AND ${t.reconciliationCount} >= 0`,
    ),
    check(
      'outbound_delivery_lease_lifecycle_chk',
      sql`(
        ${t.status} = 'leased'
        AND ${t.leaseOwner} IS NOT NULL
        AND ${t.leaseToken} IS NOT NULL
        AND ${t.leaseExpiresAt} IS NOT NULL
      ) OR (
        ${t.status} <> 'leased'
        AND ${t.leaseOwner} IS NULL
        AND ${t.leaseToken} IS NULL
        AND ${t.leaseExpiresAt} IS NULL
      )`,
    ),
    check(
      'outbound_delivery_uncertain_lifecycle_chk',
      sql`(${t.status} = 'uncertain' AND ${t.uncertainSince} IS NOT NULL)
        OR (${t.status} <> 'uncertain')`,
    ),
    check(
      'outbound_delivery_completed_lifecycle_chk',
      sql`(${t.status} = 'completed' AND ${t.completedAt} IS NOT NULL)
        OR (${t.status} <> 'completed' AND ${t.completedAt} IS NULL)`,
    ),
    unique('outbound_delivery_id_account_uidx').on(t.id, t.mailAccountId),
    unique('outbound_delivery_account_submission_uidx').on(t.mailAccountId, t.submissionId),
    unique('outbound_delivery_id_account_submission_uidx').on(
      t.id,
      t.mailAccountId,
      t.submissionId,
    ),
    foreignKey({
      name: 'outbound_delivery_account_connection_fk',
      columns: [t.mailAccountId, t.connectionId],
      foreignColumns: [mailAccount.id, mailAccount.connectionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'outbound_delivery_submission_account_fk',
      columns: [t.submissionId, t.mailAccountId],
      foreignColumns: [emailSubmission.id, emailSubmission.mailAccountId],
    }).onDelete('cascade'),
    index('outbound_delivery_due_idx')
      .on(t.status, t.availableAt, t.id)
      .where(sql`${t.status} IN ('scheduled', 'ready', 'retry_wait', 'uncertain')`),
    index('outbound_delivery_expired_lease_idx')
      .on(t.leaseExpiresAt, t.id)
      .where(sql`${t.status} = 'leased'`),
  ],
);

export const sendAttempt = createIntegrationTable(
  'send_attempt',
  {
    id: text('id').primaryKey(),
    mailAccountId: text('mail_account_id').notNull(),
    deliveryId: text('delivery_id').notNull(),
    submissionId: text('submission_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    kind: text('kind').$type<OutboundAttemptKind>().notNull(),
    leaseToken: text('lease_token').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: text('outcome').$type<OutboundAttemptOutcome>(),
    providerCode: text('provider_code'),
    safeResponse: text('safe_response'),
    retryAt: timestamp('retry_at', { withTimezone: true }),
    remoteMessageId: text('remote_message_id'),
    remoteThreadId: text('remote_thread_id'),
  },
  (t) => [
    check('send_attempt_kind_chk', sql`${t.kind} IN ('send', 'reconcile')`),
    check(
      'send_attempt_outcome_chk',
      sql`${t.outcome} IS NULL OR ${t.outcome} IN ('sent', 'transient_failure', 'permanent_failure', 'uncertain', 'not_found')`,
    ),
    check('send_attempt_number_positive_chk', sql`${t.attemptNumber} > 0`),
    check(
      'send_attempt_lifecycle_chk',
      sql`(${t.finishedAt} IS NULL AND ${t.outcome} IS NULL)
        OR (${t.finishedAt} IS NOT NULL AND ${t.outcome} IS NOT NULL)`,
    ),
    unique('send_attempt_id_account_uidx').on(t.id, t.mailAccountId),
    unique('send_attempt_account_delivery_number_uidx').on(
      t.mailAccountId,
      t.deliveryId,
      t.attemptNumber,
    ),
    foreignKey({
      name: 'send_attempt_delivery_account_submission_fk',
      columns: [t.deliveryId, t.mailAccountId, t.submissionId],
      foreignColumns: [
        outboundDelivery.id,
        outboundDelivery.mailAccountId,
        outboundDelivery.submissionId,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'send_attempt_submission_account_fk',
      columns: [t.submissionId, t.mailAccountId],
      foreignColumns: [emailSubmission.id, emailSubmission.mailAccountId],
    }).onDelete('cascade'),
    uniqueIndex('send_attempt_open_delivery_uidx')
      .on(t.mailAccountId, t.deliveryId)
      .where(sql`${t.finishedAt} IS NULL AND ${t.kind} = 'send'`),
  ],
);
