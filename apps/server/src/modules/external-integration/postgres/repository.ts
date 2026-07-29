import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type {
  ExternalAttachmentScope,
  ExternalMessageRepository,
  ExternalMessageScope,
} from '../application/read-message';
import {
  authorizationBinding,
  connection,
  email,
  emailPart,
  mailAccount,
} from '../../../db/schema';
import type { DB } from '../../../db';

export const createPostgresExternalMessageRepository = (db: DB): ExternalMessageRepository => ({
  findMessageScope: async ({ messageId, ownerUserId }) => {
    const [row] = await db
      .select({
        mailAccountId: email.mailAccountId,
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
      .where(
        and(
          eq(email.id, messageId),
          isNull(email.destroyedAt),
          eq(mailAccount.userId, ownerUserId),
          eq(connection.userId, ownerUserId),
          eq(authorizationBinding.authSource, 'nango'),
          isNotNull(authorizationBinding.nangoConnectionId),
        ),
      )
      .limit(1);

    if (row?.nangoConnectionId === null || row === undefined) return null;
    return {
      mailAccountId: row.mailAccountId,
      nangoConnectionId: row.nangoConnectionId,
      channelId: row.channelId,
    } as ExternalMessageScope;
  },

  findAttachmentScope: async ({ attachmentId, ownerUserId }) => {
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
      .where(
        and(
          eq(emailPart.id, attachmentId),
          inArray(emailPart.kind, ['inline', 'attachment']),
          isNotNull(emailPart.blobId),
          isNull(email.destroyedAt),
          eq(mailAccount.userId, ownerUserId),
          eq(connection.userId, ownerUserId),
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
