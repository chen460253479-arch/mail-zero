import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';

import type {
  ExternalAttachmentScope,
  ExternalMessageRepository,
  ExternalMessageScope,
} from '../application/read-message';
import type {
  CreateExternalAccessGrantRecord,
  ExternalAccessGrantWriter,
} from '../application/create-access-grant';
import {
  authorizationBinding,
  connection,
  email,
  emailPart,
  mailAccount,
  user,
} from '../../../db/schema';
import type { ExternalCustomerMarkerRepository } from '../application/set-customer-marker';
import { runPostgresMailTransaction } from '../../mail/postgres/postgres-unit-of-work';
import type { ExternalLaunchCodeConsumer } from '../application/consume-launch-code';
import type { MailDatabase } from '../../mail/postgres/repositories/database';
import { crmCustomerMarker, externalAccessGrant } from './schema';
import type { DB } from '../../../db';

type ExternalMessageWriteScope = ExternalMessageScope & { threadId: string };

const findMessageWriteScope = async (
  db: MailDatabase,
  messageId: string,
): Promise<ExternalMessageWriteScope | null> => {
  const [row] = await db
    .select({
      mailAccountId: email.mailAccountId,
      userId: mailAccount.userId,
      nangoConnectionId: authorizationBinding.nangoConnectionId,
      channelId: connection.channelId,
      threadId: email.threadId,
    })
    .from(email)
    .innerJoin(mailAccount, eq(mailAccount.id, email.mailAccountId))
    .innerJoin(
      connection,
      and(eq(connection.id, mailAccount.connectionId), eq(connection.userId, mailAccount.userId)),
    )
    .innerJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
    .innerJoin(user, eq(user.id, mailAccount.userId))
    .where(
      and(
        eq(email.id, messageId),
        isNull(email.destroyedAt),
        eq(user.role, 'user'),
        isNotNull(user.username),
        eq(authorizationBinding.authSource, 'nango'),
        isNotNull(authorizationBinding.nangoConnectionId),
      ),
    )
    .limit(1);

  if (row?.nangoConnectionId === null || row === undefined) return null;
  return row as ExternalMessageWriteScope;
};

export const createPostgresExternalMessageRepository = (db: DB): ExternalMessageRepository => ({
  findMessageScope: async ({ messageId }) => {
    const row = await findMessageWriteScope(db, messageId);
    if (row === null) return null;
    return {
      mailAccountId: row.mailAccountId,
      userId: row.userId,
      nangoConnectionId: row.nangoConnectionId,
      channelId: row.channelId,
    } as ExternalMessageScope;
  },

  findAttachmentScope: async ({ attachmentId }) => {
    const [row] = await db
      .select({
        mailAccountId: emailPart.mailAccountId,
        emailId: emailPart.emailId,
        partId: emailPart.id,
      })
      .from(emailPart)
      .innerJoin(
        email,
        and(eq(email.id, emailPart.emailId), eq(email.mailAccountId, emailPart.mailAccountId)),
      )
      .innerJoin(mailAccount, eq(mailAccount.id, emailPart.mailAccountId))
      .innerJoin(
        connection,
        and(eq(connection.id, mailAccount.connectionId), eq(connection.userId, mailAccount.userId)),
      )
      .innerJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
      .innerJoin(user, eq(user.id, mailAccount.userId))
      .where(
        and(
          eq(emailPart.id, attachmentId),
          inArray(emailPart.kind, ['inline', 'attachment']),
          isNull(email.destroyedAt),
          eq(user.role, 'user'),
          isNotNull(user.username),
          eq(authorizationBinding.authSource, 'nango'),
          isNotNull(authorizationBinding.nangoConnectionId),
        ),
      )
      .limit(1);

    return row === undefined ? null : (row as ExternalAttachmentScope);
  },
});

export const createPostgresExternalCustomerMarkerRepository = (
  db: DB,
): ExternalCustomerMarkerRepository => ({
  setCustomerMarker: async ({ messageId, marker }) =>
    await runPostgresMailTransaction(db, async (transaction, database) => {
      let scope = await findMessageWriteScope(database, messageId);
      if (scope === null) return null;

      await transaction.lockAccount(scope.mailAccountId);
      scope = await findMessageWriteScope(database, messageId);
      if (scope === null) return null;

      const [current] = await database
        .select({
          customerId: crmCustomerMarker.customerId,
          customerName: crmCustomerMarker.customerName,
        })
        .from(crmCustomerMarker)
        .where(
          and(
            eq(crmCustomerMarker.mailAccountId, scope.mailAccountId),
            eq(crmCustomerMarker.emailId, messageId),
          ),
        )
        .limit(1);

      const changed = marker.marked
        ? current === undefined ||
          current.customerId !== marker.customerId ||
          current.customerName !== marker.customerName
        : current !== undefined;

      if (changed && marker.marked) {
        const now = new Date();
        await database
          .insert(crmCustomerMarker)
          .values({
            mailAccountId: scope.mailAccountId,
            emailId: messageId,
            customerId: marker.customerId,
            customerName: marker.customerName,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [crmCustomerMarker.emailId, crmCustomerMarker.mailAccountId],
            set: {
              customerId: marker.customerId,
              customerName: marker.customerName,
              updatedAt: now,
            },
          });
      } else if (changed) {
        await database
          .delete(crmCustomerMarker)
          .where(
            and(
              eq(crmCustomerMarker.mailAccountId, scope.mailAccountId),
              eq(crmCustomerMarker.emailId, messageId),
            ),
          );
      }

      if (changed) {
        const now = new Date();
        const stateVersion = await transaction.nextStateVersion(scope.mailAccountId);
        await transaction.changes.recordChange({
          accountId: scope.mailAccountId,
          stateVersion,
          collection: 'email',
          entityId: messageId,
          changeType: 'updated',
          changedProperties: ['customerMarker', 'keywords'],
          createdAt: now,
        });
        await transaction.changes.recordChange({
          accountId: scope.mailAccountId,
          stateVersion,
          collection: 'thread',
          entityId: scope.threadId,
          changeType: 'updated',
          changedProperties: ['customerMarkers', 'keywords'],
          createdAt: now,
        });
      }

      return marker.marked
        ? {
            messageId,
            marked: true,
            customerId: marker.customerId,
            customerName: marker.customerName,
          }
        : {
            messageId,
            marked: false,
            customerId: null,
            customerName: null,
          };
    }),
});

export const createPostgresExternalAccessRepository = (
  db: DB,
): ExternalAccessGrantWriter & ExternalLaunchCodeConsumer => ({
  findManagedUser: async (externalUserId) => {
    const [record] = await db
      .select({ userId: user.id, role: user.role })
      .from(user)
      .where(eq(user.username, externalUserId))
      .limit(1);
    return record ?? null;
  },

  hasActiveMailbox: async (userId) => {
    const [record] = await db
      .select({ id: mailAccount.id })
      .from(connection)
      .innerJoin(
        mailAccount,
        and(eq(mailAccount.connectionId, connection.id), eq(mailAccount.userId, connection.userId)),
      )
      .where(
        and(
          eq(connection.userId, userId),
          eq(connection.status, 'connected'),
          eq(mailAccount.status, 'active'),
        ),
      )
      .limit(1);
    return record !== undefined;
  },

  createGrant: async (input: CreateExternalAccessGrantRecord) => {
    await db.insert(externalAccessGrant).values(input);
  },

  consumeGrant: async (input) =>
    await db.transaction(async (transaction) => {
      const [grant] = await transaction
        .update(externalAccessGrant)
        .set({ consumedAt: input.now })
        .where(
          and(
            eq(externalAccessGrant.codeDigest, input.codeDigest),
            isNull(externalAccessGrant.consumedAt),
            gt(externalAccessGrant.expiresAt, input.now),
          ),
        )
        .returning({ userId: externalAccessGrant.userId });
      return grant ?? null;
    }),
});
