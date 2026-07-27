import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { IngressScope, VersionedProviderState } from '../domain/sync-state';
import { mailAccount } from '../../mail/postgres/schema/accounts';
import { integrationSchema } from '../../../db/pg-schemas';

const createIntegrationTable = integrationSchema.table;

export type InboundSyncStatus = 'activating' | 'active' | 'paused' | 'auth_error';
export type InboundSyncItemStatus = 'pending' | 'processing' | 'imported' | 'failed';
export type InboundSyncAttemptOutcome = 'retry' | 'imported' | 'failed';

export const inboundSync = createIntegrationTable(
  'inbound_sync',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    provider: text('provider').notNull(),
    scopeKey: text('scope_key').notNull(),
    scope: jsonb('scope').$type<IngressScope>().notNull(),
    checkpoint: jsonb('checkpoint').$type<VersionedProviderState>(),
    status: text('status').$type<InboundSyncStatus>().notNull().default('activating'),
    subscriptionExpiresAt: timestamp('subscription_expires_at', { withTimezone: true }),
    lastSignalAt: timestamp('last_signal_at', { withTimezone: true }),
    lastDiscoveredAt: timestamp('last_discovered_at', { withTimezone: true }),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
    requestedGeneration: integer('requested_generation').notNull().default(0),
    completedGeneration: integer('completed_generation').notNull().default(0),
    pendingCursorHint: text('pending_cursor_hint'),
    nextReconcileAt: timestamp('next_reconcile_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    dispatchLeaseOwner: text('dispatch_lease_owner'),
    dispatchLeaseExpiresAt: timestamp('dispatch_lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'inbound_sync_account_fk',
      columns: [t.accountId],
      foreignColumns: [mailAccount.id],
    }).onDelete('cascade'),
    uniqueIndex('inbound_sync_account_provider_scope_uidx').on(t.accountId, t.provider, t.scopeKey),
    check(
      'inbound_sync_status_chk',
      sql`${t.status} IN ('activating', 'active', 'paused', 'auth_error')`,
    ),
    check(
      'inbound_sync_scope_version_chk',
      sql`CASE
        WHEN jsonb_typeof(${t.scope}->'version') = 'number'
        THEN (${t.scope}->>'version')::numeric >= 1
          AND mod((${t.scope}->>'version')::numeric, 1) = 0
        ELSE false
      END`,
    ),
    check(
      'inbound_sync_checkpoint_version_chk',
      sql`${t.checkpoint} IS NULL OR (
        CASE
          WHEN jsonb_typeof(${t.checkpoint}->'version') = 'number'
          THEN (${t.checkpoint}->>'version')::numeric >= 1
            AND mod((${t.checkpoint}->>'version')::numeric, 1) = 0
          ELSE false
        END
      )`,
    ),
    check(
      'inbound_sync_active_checkpoint_chk',
      sql`${t.status} <> 'active' OR ${t.checkpoint} IS NOT NULL`,
    ),
    check(
      'inbound_sync_lease_pair_chk',
      sql`(${t.leaseOwner} IS NULL) = (${t.leaseExpiresAt} IS NULL)`,
    ),
    check(
      'inbound_sync_dispatch_lease_pair_chk',
      sql`(${t.dispatchLeaseOwner} IS NULL) = (${t.dispatchLeaseExpiresAt} IS NULL)`,
    ),
    check(
      'inbound_sync_generation_nonnegative_chk',
      sql`${t.requestedGeneration} >= 0 AND ${t.completedGeneration} >= 0`,
    ),
    check(
      'inbound_sync_generation_order_chk',
      sql`${t.completedGeneration} <= ${t.requestedGeneration}`,
    ),
    index('inbound_sync_due_reconcile_idx')
      .on(t.nextReconcileAt, t.id)
      .where(sql`${t.status} = 'active'`),
    index('inbound_sync_due_renewal_idx')
      .on(t.subscriptionExpiresAt, t.id)
      .where(sql`${t.status} = 'active' AND ${t.subscriptionExpiresAt} IS NOT NULL`),
    index('inbound_sync_lease_idx')
      .on(t.leaseExpiresAt, t.id)
      .where(sql`${t.leaseExpiresAt} IS NOT NULL`),
    index('inbound_sync_due_dispatch_idx')
      .on(t.requestedGeneration, t.completedGeneration, t.nextReconcileAt, t.id)
      .where(sql`${t.status} = 'active'`),
    index('inbound_sync_dispatch_lease_idx')
      .on(t.dispatchLeaseExpiresAt, t.id)
      .where(sql`${t.dispatchLeaseExpiresAt} IS NOT NULL`),
  ],
);

export const inboundSyncItem = createIntegrationTable(
  'inbound_sync_item',
  {
    id: text('id').primaryKey(),
    syncId: text('sync_id').notNull(),
    remoteMessageId: text('remote_message_id').notNull(),
    remoteThreadId: text('remote_thread_id'),
    status: text('status').$type<InboundSyncItemStatus>().notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    localEmailId: text('local_email_id'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'inbound_sync_item_sync_fk',
      columns: [t.syncId],
      foreignColumns: [inboundSync.id],
    }).onDelete('cascade'),
    uniqueIndex('inbound_sync_item_remote_message_uidx').on(t.syncId, t.remoteMessageId),
    check(
      'inbound_sync_item_status_chk',
      sql`${t.status} IN ('pending', 'processing', 'imported', 'failed')`,
    ),
    check('inbound_sync_item_attempt_count_chk', sql`${t.attemptCount} >= 0`),
    check(
      'inbound_sync_item_lease_pair_chk',
      sql`(${t.leaseOwner} IS NULL) = (${t.leaseExpiresAt} IS NULL)`,
    ),
    check(
      'inbound_sync_item_processing_lease_chk',
      sql`(${t.status} = 'processing') = (${t.leaseOwner} IS NOT NULL)`,
    ),
    check(
      'inbound_sync_item_imported_state_chk',
      sql`(${t.status} = 'imported') = (
        ${t.localEmailId} IS NOT NULL AND ${t.importedAt} IS NOT NULL
      )`,
    ),
    index('inbound_sync_item_pending_idx')
      .on(t.syncId, t.nextAttemptAt, t.id)
      .where(sql`${t.status} = 'pending'`),
    index('inbound_sync_item_due_pending_idx')
      .on(t.nextAttemptAt, t.syncId)
      .where(sql`${t.status} = 'pending'`),
    index('inbound_sync_item_lease_idx')
      .on(t.leaseExpiresAt, t.id)
      .where(sql`${t.leaseExpiresAt} IS NOT NULL`),
  ],
);

export const inboundSyncAttempt = createIntegrationTable(
  'inbound_sync_attempt',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    outcome: text('outcome').$type<InboundSyncAttemptOutcome>().notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'inbound_sync_attempt_item_fk',
      columns: [t.itemId],
      foreignColumns: [inboundSyncItem.id],
    }).onDelete('cascade'),
    uniqueIndex('inbound_sync_attempt_item_number_uidx').on(t.itemId, t.attemptNumber),
    check('inbound_sync_attempt_outcome_chk', sql`${t.outcome} IN ('retry', 'imported', 'failed')`),
    check('inbound_sync_attempt_finished_chk', sql`${t.finishedAt} >= ${t.startedAt}`),
  ],
);
