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
import type { ExternalLaunchCodeConsumer } from '../application/consume-launch-code';
import { externalAccessGrant } from './schema';
import type { DB } from '../../../db';

export const createPostgresExternalMessageRepository = (db: DB): ExternalMessageRepository => ({
  findMessageScope: async ({ messageId }) => {
    const [row] = await db
      .select({
        mailAccountId: email.mailAccountId,
        userId: mailAccount.userId,
        nangoConnectionId: authorizationBinding.nangoConnectionId,
        channelId: connection.channelId,
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
        blobId: emailPart.blobId,
        filename: emailPart.filename,
        contentType: emailPart.contentType,
        sizeBytes: emailPart.sizeBytes,
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
          isNotNull(emailPart.blobId),
          isNull(email.destroyedAt),
          eq(user.role, 'user'),
          isNotNull(user.username),
          eq(authorizationBinding.authSource, 'nango'),
          isNotNull(authorizationBinding.nangoConnectionId),
        ),
      )
      .limit(1);

    if (row?.blobId === null || row === undefined) return null;
    return {
      ...row,
      blobId: row.blobId,
    } as ExternalAttachmentScope;
  },
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
