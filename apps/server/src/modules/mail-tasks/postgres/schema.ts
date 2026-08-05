import { check, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import type { MailTaskQueue, MailTaskStatus } from '../domain/task';
import { mailSchema } from '../../../db/pg-schemas';

export const mailTask = mailSchema.table(
  'task',
  {
    id: text('id').primaryKey(),
    queue: text('queue').$type<MailTaskQueue>().notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').$type<MailTaskStatus>().notNull().default('ready'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('mail_task_queue_chk', sql`${t.queue} IN ('ingress', 'outbound', 'external')`),
    check('mail_task_type_chk', sql`char_length(${t.type}) > 0`),
    check('mail_task_status_chk', sql`${t.status} IN ('ready', 'running', 'retry', 'dead')`),
    check('mail_task_attempts_chk', sql`${t.attempts} >= 0`),
    check('mail_task_max_attempts_chk', sql`${t.maxAttempts} >= 1`),
    check(
      'mail_task_lease_chk',
      sql`(
        ${t.status} = 'running'
        AND ${t.leaseOwner} IS NOT NULL
        AND ${t.leaseExpiresAt} IS NOT NULL
      ) OR (
        ${t.status} <> 'running'
        AND ${t.leaseOwner} IS NULL
        AND ${t.leaseExpiresAt} IS NULL
      )`,
    ),
    uniqueIndex('mail_task_live_dedupe_uidx')
      .on(t.queue, t.dedupeKey)
      .where(sql`${t.status} IN ('ready', 'running', 'retry')`),
    index('mail_task_due_idx')
      .on(t.queue, t.status, t.runAt, t.id)
      .where(sql`${t.status} IN ('ready', 'retry')`),
    index('mail_task_lease_expiry_idx')
      .on(t.leaseExpiresAt, t.id)
      .where(sql`${t.status} = 'running'`),
    index('mail_task_dead_idx')
      .on(t.completedAt, t.id)
      .where(sql`${t.status} = 'dead'`),
  ],
);
