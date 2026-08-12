import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';

import type { MailNotificationOutboxRepository } from '../domain/event';
import { mailNotificationOutbox } from './schema';
import type { DB } from '../../../db';

const claimableStatuses = ['ready', 'retry'] as const;

const requirePositiveInteger = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('MAIL_NOTIFICATION_INVALID_LIMIT');
  }
};

export const createPostgresMailNotificationRepository = (
  db: DB,
  options: {
    enabled: boolean;
  },
): MailNotificationOutboxRepository => ({
  enqueue: async (input) => {
    if (!options.enabled) return;
    await db.execute(sql`
      INSERT INTO mail.notification_outbox (
        event_id,
        message_id,
        mail_account_id,
        kind,
        create_customer_if_missing,
        status,
        run_at,
        attempts,
        max_attempts,
        created_at,
        updated_at
      )
      SELECT
        ${input.eventId},
        candidate.id,
        candidate.mail_account_id,
        ${input.kind},
        ${input.createCustomerIfMissing},
        'ready',
        ${sql.param(input.createdAt, mailNotificationOutbox.runAt)},
        0,
        10,
        ${sql.param(input.createdAt, mailNotificationOutbox.createdAt)},
        ${sql.param(input.createdAt, mailNotificationOutbox.updatedAt)}
      FROM mail.email AS candidate
      INNER JOIN mail.account AS account
        ON account.id = candidate.mail_account_id
      INNER JOIN integration.connection AS mailbox_connection
        ON mailbox_connection.id = account.connection_id
        AND mailbox_connection.user_id = account.user_id
      INNER JOIN integration.authorization_binding AS auth_binding
        ON auth_binding.connection_id = mailbox_connection.id
      INNER JOIN auth.user_account AS managed_user
        ON managed_user.id = account.user_id
      WHERE candidate.id = ${input.messageId}
        AND candidate.mail_account_id = ${input.accountId}
        AND candidate.destroyed_at IS NULL
        AND managed_user.role = 'user'
        AND managed_user.username IS NOT NULL
        AND auth_binding.auth_source = 'nango'
        AND auth_binding.nango_connection_id IS NOT NULL
      ON CONFLICT (event_id) DO NOTHING
    `);
  },

  claim: async (input) => {
    requirePositiveInteger(input.limit);
    requirePositiveInteger(input.leaseForMs);
    return await db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ eventId: mailNotificationOutbox.eventId })
        .from(mailNotificationOutbox)
        .where(
          or(
            and(
              inArray(mailNotificationOutbox.status, claimableStatuses),
              lte(mailNotificationOutbox.runAt, input.now),
            ),
            and(
              eq(mailNotificationOutbox.status, 'running'),
              lte(mailNotificationOutbox.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(asc(mailNotificationOutbox.runAt), asc(mailNotificationOutbox.eventId))
        .limit(input.limit)
        .for('update', { skipLocked: true });
      if (candidates.length === 0) return [];

      const rows = await transaction
        .update(mailNotificationOutbox)
        .set({
          status: 'running',
          attempts: sql`${mailNotificationOutbox.attempts} + 1`,
          leaseOwner: input.owner,
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseForMs),
          updatedAt: input.now,
        })
        .where(
          inArray(
            mailNotificationOutbox.eventId,
            candidates.map(({ eventId }) => eventId),
          ),
        )
        .returning();
      return rows.map((row) => ({
        eventId: row.eventId,
        messageId: row.messageId,
        accountId: row.mailAccountId,
        kind: row.kind,
        createCustomerIfMissing: row.createCustomerIfMissing,
        attempts: row.attempts,
        leaseOwner: input.owner,
      }));
    });
  },

  complete: async (input) => {
    const rows = await db
      .delete(mailNotificationOutbox)
      .where(
        and(
          eq(mailNotificationOutbox.eventId, input.eventId),
          eq(mailNotificationOutbox.status, 'running'),
          eq(mailNotificationOutbox.leaseOwner, input.owner),
        ),
      )
      .returning({ eventId: mailNotificationOutbox.eventId });
    return rows.length === 1;
  },

  scheduleRetry: async (input) =>
    await db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          attempts: mailNotificationOutbox.attempts,
          maxAttempts: mailNotificationOutbox.maxAttempts,
        })
        .from(mailNotificationOutbox)
        .where(
          and(
            eq(mailNotificationOutbox.eventId, input.eventId),
            eq(mailNotificationOutbox.status, 'running'),
            eq(mailNotificationOutbox.leaseOwner, input.owner),
          ),
        )
        .limit(1)
        .for('update');
      if (current === undefined) return 'lost' as const;

      const exhausted = current.attempts >= current.maxAttempts;
      await transaction
        .update(mailNotificationOutbox)
        .set({
          status: exhausted ? 'dead' : 'retry',
          runAt: input.runAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorMessage: input.errorMessage,
          updatedAt: input.now,
          completedAt: exhausted ? input.now : null,
        })
        .where(
          and(
            eq(mailNotificationOutbox.eventId, input.eventId),
            eq(mailNotificationOutbox.status, 'running'),
            eq(mailNotificationOutbox.leaseOwner, input.owner),
          ),
        );
      return exhausted ? ('dead' as const) : ('retry' as const);
    }),
});
