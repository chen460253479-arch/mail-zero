import { and, eq, inArray } from 'drizzle-orm';

import { authorizationBinding, connection } from '../../../db/schema';
import type { MailChannelId } from '../../../mail-channel/contracts';
import { mailAccount } from '../../mail/postgres/schema/accounts';
import { blob } from '../../mail/postgres/schema/blobs';
import type { DB } from '../../../db';

type ConnectionStatus =
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'reconnect_required'
  | 'deleting';

type MailboxBindingInput = {
  userId: string;
  existingMailboxId: string | null;
  mailbox: {
    email: string;
    normalizedEmail: string;
    name: string;
    picture: string;
    channelId: MailChannelId;
    providerKey: string;
  };
  authorization: {
    authSource: 'zero_oauth' | 'nango' | 'manual';
    credentialType: 'oauth2' | 'basic' | 'custom';
    encryptedCredentialSnapshot: string | null;
    accessTokenExpiresAt: Date | null;
    credentialFetchedAt: Date;
    nangoConnectionId?: string | null;
    nangoProviderConfigKey?: string | null;
  };
};

type RepositoryOptions = {
  newId?: () => string;
  now?: () => Date;
};

export type MailConnectionRepositoryErrorCode =
  | 'MAILBOX_ALREADY_CONNECTED'
  | 'MAILBOX_AUTHORIZATION_ALREADY_EXISTS'
  | 'MAILBOX_IDENTITY_MISMATCH'
  | 'MAILBOX_NOT_FOUND';

export class MailConnectionRepositoryError extends Error {
  constructor(public readonly code: MailConnectionRepositoryErrorCode) {
    super(code);
    this.name = 'MailConnectionRepositoryError';
  }
}

const reservedStatuses: ConnectionStatus[] = [
  'connected',
  'disconnecting',
  'reconnect_required',
  'deleting',
];

const constraintName = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('constraint_name' in error)) {
    return null;
  }
  const value = error.constraint_name;
  return typeof value === 'string' ? value : null;
};

export const createPostgresConnectionRepository = (db: DB, options: RepositoryOptions = {}) => {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  const findOwnedConnection = async (userId: string, connectionId: string) =>
    (await db.query.connection.findFirst({
      where: and(eq(connection.id, connectionId), eq(connection.userId, userId)),
    })) ?? null;

  return {
    findOwnedConnection,

    findFirstOwnedConnection: async (userId: string) =>
      (await db.query.connection.findFirst({
        where: eq(connection.userId, userId),
      })) ?? null,

    listConnectionsWithAuthorization: async (userId: string) =>
      await db
        .select({ connection, authorization: authorizationBinding })
        .from(connection)
        .leftJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
        .where(eq(connection.userId, userId)),

    findMailboxByNormalizedEmail: async (
      userId: string,
      channelId: MailChannelId,
      normalizedEmail: string,
    ) => {
      const columns = {
        id: connection.id,
        userId: connection.userId,
        channelId: connection.channelId,
        status: connection.status,
      };
      const [active] = await db
        .select(columns)
        .from(connection)
        .where(
          and(
            eq(connection.channelId, channelId),
            eq(connection.normalizedEmail, normalizedEmail),
            inArray(connection.status, reservedStatuses),
          ),
        )
        .limit(1);
      if (active !== undefined) return active;

      const [disconnected] = await db
        .select(columns)
        .from(connection)
        .where(
          and(
            eq(connection.userId, userId),
            eq(connection.channelId, channelId),
            eq(connection.normalizedEmail, normalizedEmail),
            eq(connection.status, 'disconnected'),
          ),
        )
        .limit(1);
      return disconnected ?? null;
    },

    findConnectionWithAuthorization: async (userId: string, connectionId: string) => {
      const [record] = await db
        .select({ connection, authorization: authorizationBinding })
        .from(connection)
        .leftJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
        .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)))
        .limit(1);
      return record ?? null;
    },

    findByNangoReference: async (providerConfigKey: string, nangoConnectionId: string) => {
      const [binding] = await db
        .select({ connectionId: authorizationBinding.connectionId })
        .from(authorizationBinding)
        .where(
          and(
            eq(authorizationBinding.authSource, 'nango'),
            eq(authorizationBinding.nangoProviderConfigKey, providerConfigKey),
            eq(authorizationBinding.nangoConnectionId, nangoConnectionId),
          ),
        )
        .limit(1);
      return binding ?? null;
    },

    saveBinding: async (input: MailboxBindingInput): Promise<{ id: string }> => {
      try {
        return await db.transaction(async (transaction) => {
          const occupied = await transaction
            .select({
              id: connection.id,
              userId: connection.userId,
              status: connection.status,
            })
            .from(connection)
            .where(
              and(
                eq(connection.channelId, input.mailbox.channelId),
                eq(connection.normalizedEmail, input.mailbox.normalizedEmail),
                inArray(connection.status, reservedStatuses),
              ),
            )
            .for('update')
            .limit(1);
          const active = occupied[0];
          const isOwnedReauthorization =
            active !== undefined &&
            active.userId === input.userId &&
            active.status === 'reconnect_required' &&
            (input.existingMailboxId === null || input.existingMailboxId === active.id);
          if (active !== undefined && !isOwnedReauthorization) {
            throw new MailConnectionRepositoryError('MAILBOX_ALREADY_CONNECTED');
          }

          const timestamp = now();
          let connectionId = input.existingMailboxId ?? (isOwnedReauthorization ? active.id : null);
          if (connectionId === null) {
            const [reusable] = await transaction
              .select({ id: connection.id })
              .from(connection)
              .where(
                and(
                  eq(connection.userId, input.userId),
                  eq(connection.channelId, input.mailbox.channelId),
                  eq(connection.normalizedEmail, input.mailbox.normalizedEmail),
                  eq(connection.status, 'disconnected'),
                ),
              )
              .for('update')
              .limit(1);
            connectionId = reusable?.id ?? null;
          }
          let replaceAuthorization = false;
          if (connectionId !== null) {
            const [existing] = await transaction
              .select()
              .from(connection)
              .where(and(eq(connection.id, connectionId), eq(connection.userId, input.userId)))
              .for('update')
              .limit(1);
            if (
              existing === undefined ||
              existing.channelId !== input.mailbox.channelId ||
              existing.normalizedEmail !== input.mailbox.normalizedEmail
            ) {
              throw new MailConnectionRepositoryError('MAILBOX_IDENTITY_MISMATCH');
            }
            if (!['disconnected', 'reconnect_required'].includes(existing.status)) {
              throw new MailConnectionRepositoryError('MAILBOX_ALREADY_CONNECTED');
            }
            const authorization = await transaction.query.authorizationBinding.findFirst({
              where: eq(authorizationBinding.connectionId, connectionId),
            });
            replaceAuthorization =
              existing.status === 'reconnect_required' && authorization !== undefined;
            if (existing.status === 'disconnected' && authorization !== undefined) {
              throw new MailConnectionRepositoryError('MAILBOX_AUTHORIZATION_ALREADY_EXISTS');
            }
            await transaction
              .update(connection)
              .set({
                ...input.mailbox,
                status: 'connected',
                disconnectedAt: null,
                updatedAt: timestamp,
              })
              .where(and(eq(connection.id, connectionId), eq(connection.userId, input.userId)));
          } else {
            connectionId = newId();
            await transaction.insert(connection).values({
              ...input.mailbox,
              id: connectionId,
              userId: input.userId,
              status: 'connected',
              disconnectedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }

          const authorization = {
            ...input.authorization,
            nangoConnectionId: input.authorization.nangoConnectionId ?? null,
            nangoProviderConfigKey: input.authorization.nangoProviderConfigKey ?? null,
            updatedAt: timestamp,
          };
          if (replaceAuthorization) {
            await transaction
              .update(authorizationBinding)
              .set(authorization)
              .where(eq(authorizationBinding.connectionId, connectionId));
          } else {
            await transaction.insert(authorizationBinding).values({
              ...authorization,
              id: newId(),
              connectionId,
              createdAt: timestamp,
            });
          }
          return { id: connectionId };
        });
      } catch (error) {
        if (constraintName(error) === 'connection_channel_email_active_uidx') {
          throw new MailConnectionRepositoryError('MAILBOX_ALREADY_CONNECTED');
        }
        throw error;
      }
    },

    removeAuthorizationBinding: async (userId: string, connectionId: string): Promise<void> => {
      if ((await findOwnedConnection(userId, connectionId)) === null) {
        throw new MailConnectionRepositoryError('MAILBOX_NOT_FOUND');
      }
      await db
        .delete(authorizationBinding)
        .where(eq(authorizationBinding.connectionId, connectionId));
    },

    markDisconnecting: async (userId: string, connectionId: string): Promise<void> => {
      const rows = await db
        .update(connection)
        .set({
          status: 'disconnecting',
          updatedAt: now(),
        })
        .where(
          and(
            eq(connection.id, connectionId),
            eq(connection.userId, userId),
            inArray(connection.status, ['connected', 'reconnect_required', 'disconnecting']),
          ),
        )
        .returning({ id: connection.id });
      if (rows.length === 0) {
        throw new MailConnectionRepositoryError('MAILBOX_NOT_FOUND');
      }
    },

    markDisconnected: async (
      userId: string,
      connectionId: string,
      disconnectedAt: Date,
    ): Promise<void> => {
      const rows = await db
        .update(connection)
        .set({
          status: 'disconnected',
          disconnectedAt,
          updatedAt: disconnectedAt,
        })
        .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)))
        .returning({ id: connection.id });
      if (rows.length === 0) {
        throw new MailConnectionRepositoryError('MAILBOX_NOT_FOUND');
      }
    },

    markReconnectRequired: async (userId: string, connectionId: string): Promise<void> => {
      const rows = await db
        .update(connection)
        .set({
          status: 'reconnect_required',
          updatedAt: now(),
        })
        .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)))
        .returning({ id: connection.id });
      if (rows.length === 0) {
        throw new MailConnectionRepositoryError('MAILBOX_NOT_FOUND');
      }
    },

    listBlobObjectKeys: async (userId: string, connectionId: string): Promise<string[]> =>
      (
        await db
          .select({ objectKey: blob.objectKey })
          .from(blob)
          .innerJoin(mailAccount, eq(mailAccount.id, blob.mailAccountId))
          .innerJoin(
            connection,
            and(eq(connection.id, mailAccount.connectionId), eq(connection.userId, userId)),
          )
          .where(eq(connection.id, connectionId))
      ).map(({ objectKey }) => objectKey),

    markDeleting: async (userId: string, connectionId: string): Promise<void> => {
      await db.transaction(async (transaction) => {
        const rows = await transaction
          .update(connection)
          .set({ status: 'deleting', updatedAt: now() })
          .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)))
          .returning({ id: connection.id });
        if (rows.length === 0) {
          throw new MailConnectionRepositoryError('MAILBOX_NOT_FOUND');
        }
        await transaction
          .update(mailAccount)
          .set({ status: 'deleting', updatedAt: now() })
          .where(and(eq(mailAccount.connectionId, connectionId), eq(mailAccount.userId, userId)));
      });
    },

    deleteMailbox: async (userId: string, connectionId: string): Promise<void> => {
      const rows = await db
        .delete(connection)
        .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)))
        .returning({ id: connection.id });
      if (rows.length === 0) {
        throw new MailConnectionRepositoryError('MAILBOX_NOT_FOUND');
      }
    },
  };
};

export type PostgresConnectionRepository = ReturnType<typeof createPostgresConnectionRepository>;
