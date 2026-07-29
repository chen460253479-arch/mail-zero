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
} from '../../../db/schema';
import type { ExternalLaunchCodeConsumer } from '../application/consume-launch-code';
import { externalAccessGrant, externalBrowserSession } from './schema';
import { EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID } from '../principal';
import type { ExternalBrowserSession } from '../contracts/access';
import type { ExternalSessionRepository } from '../session/resolve';
import type { GrantedMailboxScope } from '../contracts/access';
import type { DB } from '../../../db';

const toExternalBrowserSession = (row: {
  id: string;
  ownerUserId: string;
  scopes: GrantedMailboxScope[];
  activeConnectionId: string;
  expiresAt: Date;
  updatedAt: Date;
}): ExternalBrowserSession => {
  if (row.ownerUserId !== EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID) {
    throw new Error('EXTERNAL_SESSION_INVALID_OWNER');
  }
  if (!row.scopes.some(({ connectionId }) => connectionId === row.activeConnectionId)) {
    throw new Error('EXTERNAL_SESSION_ACTIVE_SCOPE_MISMATCH');
  }
  return {
    ...row,
    ownerUserId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
  };
};

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

export const createPostgresExternalAccessRepository = (
  db: DB,
): ExternalAccessGrantWriter & ExternalLaunchCodeConsumer & ExternalSessionRepository => ({
  resolveMailboxScopes: async ({ ownerUserId, nangoConnectionIds }) => {
    const rows = await db
      .select({
        nangoConnectionId: authorizationBinding.nangoConnectionId,
        connectionId: connection.id,
        mailAccountId: mailAccount.id,
      })
      .from(authorizationBinding)
      .innerJoin(connection, eq(connection.id, authorizationBinding.connectionId))
      .innerJoin(
        mailAccount,
        and(eq(mailAccount.connectionId, connection.id), eq(mailAccount.userId, connection.userId)),
      )
      .where(
        and(
          eq(connection.userId, ownerUserId),
          eq(authorizationBinding.authSource, 'nango'),
          isNotNull(authorizationBinding.nangoConnectionId),
          inArray(authorizationBinding.nangoConnectionId, nangoConnectionIds),
          eq(connection.status, 'connected'),
          eq(mailAccount.status, 'active'),
        ),
      );
    return rows.flatMap((row): GrantedMailboxScope[] =>
      row.nangoConnectionId === null
        ? []
        : [
            {
              nangoConnectionId: row.nangoConnectionId,
              connectionId: row.connectionId,
              mailAccountId: row.mailAccountId,
            },
          ],
    );
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
        .returning({
          ownerUserId: externalAccessGrant.ownerUserId,
          scopes: externalAccessGrant.scopes,
        });
      const activeConnectionId = grant?.scopes[0]?.connectionId;
      if (grant === undefined) return null;
      if (activeConnectionId === undefined) {
        throw new Error('EXTERNAL_ACCESS_GRANT_EMPTY_SCOPE');
      }
      if (grant.ownerUserId !== EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID) {
        throw new Error('EXTERNAL_ACCESS_GRANT_INVALID_OWNER');
      }
      const [session] = await transaction
        .insert(externalBrowserSession)
        .values({
          ...input.session,
          ownerUserId: grant.ownerUserId,
          scopes: grant.scopes,
          activeConnectionId,
        })
        .returning();
      if (session === undefined) {
        throw new Error('EXTERNAL_SESSION_CREATE_FAILED');
      }
      return toExternalBrowserSession({
        id: session.id,
        ownerUserId: session.ownerUserId,
        scopes: session.scopes,
        activeConnectionId: session.activeConnectionId,
        expiresAt: session.expiresAt,
        updatedAt: session.updatedAt,
      });
    }),

  findSessionByDigest: async (input) => {
    const [session] = await db
      .select()
      .from(externalBrowserSession)
      .where(
        and(
          eq(externalBrowserSession.tokenDigest, input.tokenDigest),
          gt(externalBrowserSession.expiresAt, input.now),
        ),
      )
      .limit(1);
    return session === undefined ? null : toExternalBrowserSession(session);
  },

  renewSession: async (input) => {
    const [session] = await db
      .update(externalBrowserSession)
      .set({
        updatedAt: input.now,
        expiresAt: input.expiresAt,
      })
      .where(
        and(
          eq(externalBrowserSession.id, input.id),
          gt(externalBrowserSession.expiresAt, input.now),
        ),
      )
      .returning();
    return session === undefined ? null : toExternalBrowserSession(session);
  },
});
