import { and, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';

import type {
  ExternalMailSubmissionRecord,
  ExternalMailSubmissionRepository,
  ExternalMailSubmissionView,
} from '../application/mail-submission';
import { authorizationBinding, connection, user } from '../../../db/core-schema';
import { mailAccount, mailIdentity } from '../../mail/postgres/schema/accounts';
import { emailSubmission } from '../../mail/postgres/schema/submissions';
import { mailTask } from '../../mail-tasks/postgres/schema';
import { externalMailSubmission } from './schema';
import type { DB } from '../../../db';

const toRecord = (row: typeof externalMailSubmission.$inferSelect): ExternalMailSubmissionRecord =>
  row;

type ViewRow = typeof externalMailSubmission.$inferSelect & {
  linkedStatus: typeof emailSubmission.$inferSelect.status | null;
  linkedLastErrorCode: string | null;
  linkedLastErrorMessage: string | null;
  linkedSentAt: Date | null;
};

const toView = (row: ViewRow): ExternalMailSubmissionView => {
  const publicStatus =
    row.status === 'submitted'
      ? (row.linkedStatus ?? 'failed')
      : row.status === 'failed'
        ? 'failed'
        : row.status;
  return {
    ...toRecord(row),
    publicStatus,
    sentAt: row.linkedSentAt,
    lastErrorCode: row.status === 'submitted' ? row.linkedLastErrorCode : row.lastErrorCode,
    lastErrorMessage:
      row.status === 'submitted' ? row.linkedLastErrorMessage : row.lastErrorMessage,
  };
};

const createViewReader = (db: DB) => {
  const selectView = () =>
    db
      .select({
        ...getTableColumns(externalMailSubmission),
        linkedStatus: emailSubmission.status,
        linkedLastErrorCode: emailSubmission.lastErrorCode,
        linkedLastErrorMessage: emailSubmission.lastErrorMessage,
        linkedSentAt: emailSubmission.sentAt,
      })
      .from(externalMailSubmission)
      .leftJoin(
        emailSubmission,
        and(
          eq(emailSubmission.id, externalMailSubmission.submissionId),
          eq(emailSubmission.mailAccountId, externalMailSubmission.mailAccountId),
        ),
      );

  return {
    async findById(id: string): Promise<ExternalMailSubmissionView | null> {
      const [row] = await selectView().where(eq(externalMailSubmission.id, id)).limit(1);
      return row === undefined ? null : toView(row);
    },
    async findByIdempotency(
      externalUserId: string,
      externalConnectionId: string,
      idempotencyKey: string,
    ): Promise<ExternalMailSubmissionView | null> {
      const [row] = await selectView()
        .where(
          and(
            eq(externalMailSubmission.externalUserId, externalUserId),
            eq(externalMailSubmission.externalConnectionId, externalConnectionId),
            eq(externalMailSubmission.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return row === undefined ? null : toView(row);
    },
  };
};

export const createPostgresExternalMailSubmissionRepository = (
  db: DB,
): ExternalMailSubmissionRepository => {
  const reader = createViewReader(db);
  return {
    ...reader,

    resolveScope: async (externalUserId, externalConnectionId) => {
      const [managedUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.username, externalUserId), eq(user.role, 'user')))
        .limit(1);
      if (managedUser === undefined) return 'user_not_found';

      const rows = await db
        .select({
          userId: user.id,
          mailAccountId: mailAccount.id,
          internalConnectionId: connection.id,
          identityId: mailIdentity.id,
        })
        .from(user)
        .innerJoin(connection, eq(connection.userId, user.id))
        .innerJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
        .innerJoin(
          mailAccount,
          and(eq(mailAccount.connectionId, connection.id), eq(mailAccount.userId, user.id)),
        )
        .innerJoin(mailIdentity, eq(mailIdentity.mailAccountId, mailAccount.id))
        .where(
          and(
            eq(user.id, managedUser.id),
            eq(connection.status, 'connected'),
            eq(authorizationBinding.authSource, 'nango'),
            eq(authorizationBinding.nangoConnectionId, externalConnectionId),
            eq(mailAccount.status, 'active'),
            eq(mailIdentity.isDefault, true),
            isNull(mailIdentity.deletedAt),
          ),
        )
        .limit(2);
      if (rows.length === 0) return null;
      if (rows.length > 1) return 'ambiguous';
      return rows[0]!;
    },

    create: async ({ record, taskId }) => {
      const transactionResult = await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`zero-external-mail:${record.userId}:${record.externalConnectionId}:${record.idempotencyKey}`}))`,
        );
        const [existing] = await transaction
          .select({
            id: externalMailSubmission.id,
            requestFingerprint: externalMailSubmission.requestFingerprint,
          })
          .from(externalMailSubmission)
          .where(
            and(
              eq(externalMailSubmission.userId, record.userId),
              eq(externalMailSubmission.externalConnectionId, record.externalConnectionId),
              eq(externalMailSubmission.idempotencyKey, record.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing !== undefined) {
          return {
            id: existing.id,
            outcome:
              existing.requestFingerprint === record.requestFingerprint
                ? ('existing' as const)
                : ('conflict' as const),
          };
        }

        await transaction.insert(externalMailSubmission).values(record);
        const command = {
          type: 'prepare_external_mail_submission' as const,
          submissionId: record.id,
        };
        await transaction.insert(mailTask).values({
          id: taskId,
          queue: 'external',
          type: command.type,
          payload: command,
          dedupeKey: `external:submission:${record.id}`,
          runAt: record.createdAt,
          maxAttempts: 5,
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
        });
        return { id: record.id, outcome: 'created' as const };
      });

      const submission = await reader.findById(transactionResult.id);
      if (submission === null) throw new Error('EXTERNAL_MAIL_SUBMISSION_CREATE_LOST');
      return { outcome: transactionResult.outcome, submission };
    },

    beginPreparation: async (id, now) => {
      const [row] = await db
        .update(externalMailSubmission)
        .set({
          status: 'preparing',
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(externalMailSubmission.id, id),
            inArray(externalMailSubmission.status, ['accepted', 'preparing']),
          ),
        )
        .returning();
      return row === undefined ? null : toRecord(row);
    },

    markDraftCreated: async (id, emailId, now) => {
      await db
        .update(externalMailSubmission)
        .set({ emailId, updatedAt: now })
        .where(
          and(
            eq(externalMailSubmission.id, id),
            inArray(externalMailSubmission.status, ['accepted', 'preparing']),
          ),
        );
    },

    markSubmitted: async (id, emailId, submissionId, now) => {
      await db
        .update(externalMailSubmission)
        .set({
          status: 'submitted',
          emailId,
          submissionId,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(externalMailSubmission.id, id),
            inArray(externalMailSubmission.status, ['accepted', 'preparing']),
          ),
        );
    },

    recordProcessingFailure: async ({ id, code, message, final, now }) => {
      await db
        .update(externalMailSubmission)
        .set({
          status: final ? 'failed' : 'accepted',
          lastErrorCode: code,
          lastErrorMessage: message,
          updatedAt: now,
        })
        .where(
          and(
            eq(externalMailSubmission.id, id),
            inArray(externalMailSubmission.status, ['accepted', 'preparing']),
          ),
        );
    },
  };
};
