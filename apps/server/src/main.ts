import {
  account,
  authorizationBinding,
  connection,
  note,
  session,
  user,
  userHotkeys,
  userSettings,
  writingStyleMatrix,
  emailTemplate,
} from './db/schema';
import {
  createUpdatedMatrixFromNewEmail,
  initializeStyleMatrixFromEmail,
  type EmailMatrix,
  type WritingStyleMatrix,
} from './services/writing-style-service';
import {
  assertMailChannelBinding,
  channelIdToProviderId,
  getMailChannel,
  providerIdToChannelId,
} from './lib/mail-channel/registry';
import {
  enqueueDueMailIngressWork,
  runMailIngressCommand,
} from './lib/mail-channel/gmail/ingress-runtime';
import {
  toAttachmentFiles,
  type SerializedAttachment,
  type AttachmentFile,
} from './lib/attachments';
import { assertAuthorizationCanBeAttached } from './modules/mail-accounts/application/disconnect-mailbox';
import { SyncThreadsCoordinatorWorkflow } from './workflows/sync-threads-coordinator-workflow';
import { normalizeMailboxEmail } from './modules/mail-accounts/application/mailbox-identity';
import { createZeroOAuthSnapshot } from './modules/mail-accounts/credentials/zero-oauth';
import { encryptCredential } from './infrastructure/security/credential-encryption';
import { parseMailIngressCommand } from './modules/mail-sync/application/commands';
import { WorkerEntrypoint, DurableObject, RpcTarget } from 'cloudflare:workers';
import { handleGmailPush } from './mail-channel/gmail/inbound/handle-push';
// import { instrument, type ResolveConfigFn } from '@microlabs/otel-cf-workers';
import { getZeroAgent, getZeroDB, verifyToken } from './lib/server-utils';
import { SyncThreadsWorkflow } from './workflows/sync-threads-workflow';
import { ShardRegistry, ZeroAgent, ZeroDriver } from './routes/agent';
import { ThreadSyncWorker } from './routes/agent/sync-worker';
import type { MailChannelId } from './lib/mail-channel/types';
import { oAuthDiscoveryMetadata } from 'better-auth/plugins';
import { EProviders, type IEmailSendBatch } from './types';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { ThinkingMCP } from './lib/sequential-thinking';
import { MailSyncError } from './modules/mail-sync';

import { ensureConfiguredAdmin } from './lib/admin-provisioning';
import { integrationOAuthRouter } from './routes/integrations';
import { contextStorage } from 'hono/context-storage';
import { defaultUserSettings } from './lib/schemas';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { enableBrainFunction } from './lib/brain';
import { trpcServer } from '@hono/trpc-server';
import { agentsMiddleware } from 'hono-agents';
import { ZeroMCP } from './routes/agent/mcp';
import { publicRouter } from './routes/auth';
import { WorkflowRunner } from './pipelines';
import { initTracing } from './lib/tracing';
import { env, type ZeroEnv } from './env';
import type { HonoContext } from './ctx';
import { createDb, type DB } from './db';
import { createAuth } from './lib/auth';
import { aiRouter } from './routes/ai';
import { appRouter } from './trpc';
import { cors } from 'hono/cors';
import { Hono } from 'hono';

const SENTRY_HOST = 'o4509328786915328.ingest.us.sentry.io';
const SENTRY_PROJECT_IDS = new Set(['4509328795303936']);

type ConnectionWithAuthorization = {
  connection: typeof connection.$inferSelect;
  authorization: typeof authorizationBinding.$inferSelect | null;
};

type CreateMailboxInput = Omit<
  typeof connection.$inferInsert,
  'id' | 'userId' | 'normalizedEmail' | 'createdAt' | 'updatedAt'
>;

type CreateAuthorizationInput = Omit<
  typeof authorizationBinding.$inferInsert,
  'id' | 'connectionId' | 'createdAt' | 'updatedAt'
>;

type LegacyConnectionDetails = {
  expiresAt: Date;
  scope: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  name?: string | null;
  picture?: string | null;
};

export class DbRpcDO extends RpcTarget {
  constructor(
    private mainDo: ZeroDB,
    private userId: string,
  ) {
    super();
  }

  async findUser(): Promise<typeof user.$inferSelect | undefined> {
    return await this.mainDo.findUser(this.userId);
  }

  async findUserConnection(
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.mainDo.findUserConnection(this.userId, connectionId);
  }

  async findConnectionWithAuthorization(
    connectionId: string,
  ): Promise<ConnectionWithAuthorization | undefined> {
    return await this.mainDo.findConnectionWithAuthorization(this.userId, connectionId);
  }

  async updateUser(data: Partial<typeof user.$inferInsert>) {
    return await this.mainDo.updateUser(this.userId, data);
  }

  async deleteConnection(connectionId: string) {
    return await this.mainDo.deleteConnection(connectionId, this.userId);
  }

  async removeAuthorizationBinding(connectionId: string) {
    return await this.mainDo.removeAuthorizationBinding(this.userId, connectionId);
  }

  async markConnectionDisconnected(connectionId: string, disconnectedAt: Date) {
    return await this.mainDo.markConnectionDisconnected(this.userId, connectionId, disconnectedAt);
  }

  async markConnectionDeleting(connectionId: string) {
    return await this.mainDo.markConnectionDeleting(this.userId, connectionId);
  }

  async deleteMailbox(connectionId: string) {
    return await this.mainDo.deleteMailbox(this.userId, connectionId);
  }

  async findFirstConnection(): Promise<typeof connection.$inferSelect | undefined> {
    return await this.mainDo.findFirstConnection(this.userId);
  }

  async findManyConnections(): Promise<(typeof connection.$inferSelect)[]> {
    return await this.mainDo.findManyConnections(this.userId);
  }

  async findManyConnectionsWithAuthorization(): Promise<ConnectionWithAuthorization[]> {
    return await this.mainDo.findManyConnectionsWithAuthorization(this.userId);
  }

  async findConnectionByNormalizedEmail(channelId: MailChannelId, normalizedEmail: string) {
    return await this.mainDo.findConnectionByNormalizedEmail(
      this.userId,
      channelId,
      normalizedEmail,
    );
  }

  async findAuthorizationByNangoReference(integrationId: string, connectionId: string) {
    return await this.mainDo.findAuthorizationByNangoReference(integrationId, connectionId);
  }

  async findManyNotesByThreadId(
    connectionId: string,
    threadId: string,
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.mainDo.findManyNotesByThreadId(this.userId, connectionId, threadId);
  }

  async createNote(
    connectionId: string,
    payload: Omit<typeof note.$inferInsert, 'userId' | 'connectionId'>,
  ) {
    return await this.mainDo.createNote(
      this.userId,
      connectionId,
      payload as typeof note.$inferInsert,
    );
  }

  async updateNote(
    connectionId: string,
    noteId: string,
    payload: Partial<typeof note.$inferInsert>,
  ) {
    return await this.mainDo.updateNote(this.userId, connectionId, noteId, payload);
  }

  async updateManyNotes(
    connectionId: string,
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean> {
    return await this.mainDo.updateManyNotes(this.userId, connectionId, notes);
  }

  async findManyNotesByIds(
    connectionId: string,
    noteIds: string[],
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.mainDo.findManyNotesByIds(this.userId, connectionId, noteIds);
  }

  async deleteNote(connectionId: string, noteId: string) {
    return await this.mainDo.deleteNote(this.userId, connectionId, noteId);
  }

  async findNoteById(
    connectionId: string,
    noteId: string,
  ): Promise<typeof note.$inferSelect | undefined> {
    return await this.mainDo.findNoteById(this.userId, connectionId, noteId);
  }

  async findHighestNoteOrder(connectionId: string): Promise<{ order: number } | undefined> {
    return await this.mainDo.findHighestNoteOrder(this.userId, connectionId);
  }

  async deleteUser() {
    return await this.mainDo.deleteUser(this.userId);
  }

  async findUserSettings(): Promise<typeof userSettings.$inferSelect | undefined> {
    return await this.mainDo.findUserSettings(this.userId);
  }

  async findUserHotkeys(): Promise<(typeof userHotkeys.$inferSelect)[]> {
    return await this.mainDo.findUserHotkeys(this.userId);
  }

  async insertUserHotkeys(shortcuts: (typeof userHotkeys.$inferInsert)[]) {
    return await this.mainDo.insertUserHotkeys(this.userId, shortcuts);
  }

  async insertUserSettings(settings: typeof defaultUserSettings) {
    return await this.mainDo.insertUserSettings(this.userId, settings);
  }

  async updateUserSettings(settings: typeof defaultUserSettings) {
    return await this.mainDo.updateUserSettings(this.userId, settings);
  }

  async createConnection(
    providerId: EProviders,
    email: string,
    updatingInfo: LegacyConnectionDetails,
  ): Promise<{ id: string }[]> {
    return await this.mainDo.createConnection(providerId, email, this.userId, updatingInfo);
  }

  async createMailboxWithAuthorization(
    mailbox: CreateMailboxInput,
    authorization: CreateAuthorizationInput,
  ): Promise<{ id: string }> {
    return await this.mainDo.createMailboxWithAuthorization(this.userId, mailbox, authorization);
  }

  async findConnectionById(
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.mainDo.findConnectionById(connectionId);
  }

  async syncUserMatrix(connectionId: string, emailStyleMatrix: EmailMatrix) {
    return await this.mainDo.syncUserMatrix(connectionId, emailStyleMatrix);
  }

  async findWritingStyleMatrix(
    connectionId: string,
  ): Promise<typeof writingStyleMatrix.$inferSelect | undefined> {
    return await this.mainDo.findWritingStyleMatrix(connectionId);
  }

  async deleteActiveConnection(connectionId: string) {
    return await this.mainDo.deleteActiveConnection(this.userId, connectionId);
  }

  async updateConnection(
    connectionId: string,
    updatingInfo: Partial<typeof connection.$inferInsert>,
  ) {
    return await this.mainDo.updateConnection(this.userId, connectionId, updatingInfo);
  }

  async listEmailTemplates(): Promise<(typeof emailTemplate.$inferSelect)[]> {
    return await this.mainDo.findManyEmailTemplates(this.userId);
  }

  async createEmailTemplate(payload: Omit<typeof emailTemplate.$inferInsert, 'userId'>) {
    return await this.mainDo.createEmailTemplate(this.userId, payload);
  }

  async deleteEmailTemplate(templateId: string) {
    return await this.mainDo.deleteEmailTemplate(this.userId, templateId);
  }

  async updateEmailTemplate(templateId: string, data: Partial<typeof emailTemplate.$inferInsert>) {
    return await this.mainDo.updateEmailTemplate(this.userId, templateId, data);
  }
}

class ZeroDB extends DurableObject<ZeroEnv> {
  db: DB = createDb(this.env.HYPERDRIVE.connectionString).db;

  async setMetaData(userId: string) {
    return new DbRpcDO(this, userId);
  }

  async findUser(userId: string): Promise<typeof user.$inferSelect | undefined> {
    return await this.db.query.user.findFirst({
      where: eq(user.id, userId),
    });
  }

  async findUserConnection(
    userId: string,
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.db.query.connection.findFirst({
      where: and(eq(connection.userId, userId), eq(connection.id, connectionId)),
    });
  }

  async findConnectionWithAuthorization(
    userId: string,
    connectionId: string,
  ): Promise<ConnectionWithAuthorization | undefined> {
    const [result] = await this.db
      .select({
        connection,
        authorization: authorizationBinding,
      })
      .from(connection)
      .leftJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
      .where(and(eq(connection.userId, userId), eq(connection.id, connectionId)))
      .limit(1);
    return result;
  }

  async updateUser(userId: string, data: Partial<typeof user.$inferInsert>) {
    return await this.db.update(user).set(data).where(eq(user.id, userId));
  }

  async deleteConnection(connectionId: string, userId: string) {
    const connections = await this.findManyConnections(userId);
    if (connections.length <= 1) {
      throw new Error('Cannot delete the last connection. At least one connection is required.');
    }
    return await this.db
      .delete(connection)
      .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
  }

  private async requireUserConnection(userId: string, connectionId: string) {
    const foundConnection = await this.findUserConnection(userId, connectionId);
    if (!foundConnection) throw new Error('Mailbox not found');
    return foundConnection;
  }

  async removeAuthorizationBinding(userId: string, connectionId: string) {
    await this.requireUserConnection(userId, connectionId);
    await this.db
      .delete(authorizationBinding)
      .where(eq(authorizationBinding.connectionId, connectionId));
  }

  async markConnectionDisconnected(userId: string, connectionId: string, disconnectedAt: Date) {
    await this.requireUserConnection(userId, connectionId);
    await this.db
      .update(connection)
      .set({ status: 'disconnected', disconnectedAt, updatedAt: disconnectedAt })
      .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
  }

  async markConnectionDeleting(userId: string, connectionId: string) {
    await this.requireUserConnection(userId, connectionId);
    await this.db
      .update(connection)
      .set({ status: 'deleting', updatedAt: new Date() })
      .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
  }

  async deleteMailbox(userId: string, connectionId: string) {
    await this.requireUserConnection(userId, connectionId);
    await this.db
      .delete(connection)
      .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
  }

  async findFirstConnection(userId: string): Promise<typeof connection.$inferSelect | undefined> {
    return await this.db.query.connection.findFirst({
      where: eq(connection.userId, userId),
    });
  }

  async findManyConnections(userId: string): Promise<(typeof connection.$inferSelect)[]> {
    return await this.db.query.connection.findMany({
      where: eq(connection.userId, userId),
    });
  }

  async findManyConnectionsWithAuthorization(
    userId: string,
  ): Promise<ConnectionWithAuthorization[]> {
    return await this.db
      .select({
        connection,
        authorization: authorizationBinding,
      })
      .from(connection)
      .leftJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
      .where(eq(connection.userId, userId));
  }

  async findConnectionByNormalizedEmail(
    userId: string,
    channelId: MailChannelId,
    normalizedEmail: string,
  ) {
    const mailbox = await this.db.query.connection.findFirst({
      where: and(
        eq(connection.userId, userId),
        eq(connection.channelId, channelId),
        eq(connection.normalizedEmail, normalizedEmail),
      ),
      columns: {
        id: true,
        channelId: true,
        status: true,
      },
    });
    return mailbox ?? null;
  }

  async findAuthorizationByNangoReference(integrationId: string, connectionId: string) {
    const binding = await this.db.query.authorizationBinding.findFirst({
      where: and(
        eq(authorizationBinding.nangoProviderConfigKey, integrationId),
        eq(authorizationBinding.nangoConnectionId, connectionId),
      ),
      columns: { connectionId: true },
    });
    return binding ?? null;
  }

  async findManyNotesByThreadId(
    userId: string,
    connectionId: string,
    threadId: string,
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.db.query.note.findMany({
      where: and(
        eq(note.userId, userId),
        eq(note.connectionId, connectionId),
        eq(note.threadId, threadId),
      ),
      orderBy: [desc(note.isPinned), asc(note.order), desc(note.createdAt)],
    });
  }

  async createNote(userId: string, connectionId: string, payload: typeof note.$inferInsert) {
    return await this.db
      .insert(note)
      .values({
        ...payload,
        userId,
        connectionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  }

  async updateNote(
    userId: string,
    connectionId: string,
    noteId: string,
    payload: Partial<typeof note.$inferInsert>,
  ): Promise<typeof note.$inferSelect | undefined> {
    const [updated] = await this.db
      .update(note)
      .set({
        ...payload,
        updatedAt: new Date(),
      })
      .where(and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)))
      .returning();
    return updated;
  }

  async updateManyNotes(
    userId: string,
    connectionId: string,
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      for (const n of notes) {
        const updateData: Record<string, unknown> = {
          order: n.order,
          updatedAt: new Date(),
        };

        if (n.isPinned !== undefined) {
          updateData.isPinned = n.isPinned;
        }
        await tx
          .update(note)
          .set(updateData)
          .where(
            and(eq(note.id, n.id), eq(note.userId, userId), eq(note.connectionId, connectionId)),
          );
      }
      return true;
    });
  }

  async findManyNotesByIds(
    userId: string,
    connectionId: string,
    noteIds: string[],
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.db.query.note.findMany({
      where: and(
        eq(note.userId, userId),
        eq(note.connectionId, connectionId),
        inArray(note.id, noteIds),
      ),
    });
  }

  async deleteNote(userId: string, connectionId: string, noteId: string) {
    return await this.db
      .delete(note)
      .where(
        and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)),
      );
  }

  async findNoteById(
    userId: string,
    connectionId: string,
    noteId: string,
  ): Promise<typeof note.$inferSelect | undefined> {
    return await this.db.query.note.findFirst({
      where: and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)),
    });
  }

  async findHighestNoteOrder(
    userId: string,
    connectionId: string,
  ): Promise<{ order: number } | undefined> {
    return await this.db.query.note.findFirst({
      where: and(eq(note.userId, userId), eq(note.connectionId, connectionId)),
      orderBy: desc(note.order),
      columns: { order: true },
    });
  }

  async deleteUser(userId: string) {
    return await this.db.transaction(async (tx) => {
      await tx.delete(connection).where(eq(connection.userId, userId));
      await tx.delete(account).where(eq(account.userId, userId));
      await tx.delete(session).where(eq(session.userId, userId));
      await tx.delete(userSettings).where(eq(userSettings.userId, userId));
      await tx.delete(user).where(eq(user.id, userId));
      await tx.delete(userHotkeys).where(eq(userHotkeys.userId, userId));
    });
  }

  async findUserSettings(userId: string): Promise<typeof userSettings.$inferSelect | undefined> {
    return await this.db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });
  }

  async findUserHotkeys(userId: string): Promise<(typeof userHotkeys.$inferSelect)[]> {
    return await this.db.query.userHotkeys.findMany({
      where: eq(userHotkeys.userId, userId),
    });
  }

  async insertUserHotkeys(userId: string, shortcuts: (typeof userHotkeys.$inferInsert)[]) {
    return await this.db
      .insert(userHotkeys)
      .values({
        userId,
        shortcuts,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userHotkeys.userId,
        set: {
          shortcuts,
          updatedAt: new Date(),
        },
      });
  }

  async insertUserSettings(userId: string, settings: typeof defaultUserSettings) {
    return await this.db.insert(userSettings).values({
      id: crypto.randomUUID(),
      userId,
      settings,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async updateUserSettings(userId: string, settings: typeof defaultUserSettings) {
    return await this.db
      .insert(userSettings)
      .values({
        id: crypto.randomUUID(),
        userId,
        settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          settings,
          updatedAt: new Date(),
        },
      });
  }

  async createConnection(
    providerId: EProviders,
    email: string,
    userId: string,
    updatingInfo: LegacyConnectionDetails,
  ): Promise<{ id: string }[]> {
    if (!updatingInfo.accessToken || !updatingInfo.refreshToken) {
      throw new Error('Mailbox OAuth credential is missing');
    }
    const channelId = providerIdToChannelId(providerId);
    const channel = getMailChannel(channelId);
    const created = await this.createMailboxWithAuthorization(
      userId,
      {
        name: updatingInfo.name,
        picture: updatingInfo.picture,
        providerKey: channel.providerKey,
        channelId,
        email,
      },
      {
        authSource: 'zero_oauth',
        credentialType: 'oauth2',
        encryptedCredentialSnapshot: await encryptCredential(
          createZeroOAuthSnapshot({
            accessToken: updatingInfo.accessToken,
            refreshToken: updatingInfo.refreshToken,
            scope: updatingInfo.scope,
          }),
          this.env.CREDENTIAL_ENCRYPTION_KEY,
        ),
        accessTokenExpiresAt: updatingInfo.expiresAt,
        credentialFetchedAt: new Date(),
      },
    );
    return [created];
  }

  async createMailboxWithAuthorization(
    userId: string,
    mailbox: CreateMailboxInput,
    authorization: CreateAuthorizationInput,
  ): Promise<{ id: string }> {
    const now = new Date();
    const normalizedEmail = normalizeMailboxEmail(mailbox.email);
    assertMailChannelBinding({
      channelId: mailbox.channelId,
      providerKey: mailbox.providerKey,
      credentialType: authorization.credentialType,
    });

    return await this.db.transaction(async (tx) => {
      const existing = await tx.query.connection.findFirst({
        where: and(
          eq(connection.userId, userId),
          eq(connection.channelId, mailbox.channelId),
          eq(connection.normalizedEmail, normalizedEmail),
        ),
      });
      const connectionId = existing?.id ?? crypto.randomUUID();

      if (existing) {
        const existingAuthorization = await tx.query.authorizationBinding.findFirst({
          where: eq(authorizationBinding.connectionId, existing.id),
        });
        assertAuthorizationCanBeAttached(existing.status, Boolean(existingAuthorization));
        await tx
          .update(connection)
          .set({
            ...mailbox,
            normalizedEmail,
            status: 'connected',
            disconnectedAt: null,
            updatedAt: now,
          })
          .where(eq(connection.id, existing.id));
      } else {
        await tx.insert(connection).values({
          ...mailbox,
          id: connectionId,
          userId,
          normalizedEmail,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx.insert(authorizationBinding).values({
        ...authorization,
        id: crypto.randomUUID(),
        connectionId,
        createdAt: now,
        updatedAt: now,
      });

      return { id: connectionId };
    });
  }

  /**
   * @param connectionId Dangerous, use findUserConnection instead
   * @returns
   */
  async findConnectionById(
    connectionId: string,
  ): Promise<typeof connection.$inferSelect | undefined> {
    return await this.db.query.connection.findFirst({
      where: eq(connection.id, connectionId),
    });
  }

  async syncUserMatrix(connectionId: string, emailStyleMatrix: EmailMatrix) {
    await this.db.transaction(async (tx) => {
      const [existingMatrix] = await tx
        .select({
          numMessages: writingStyleMatrix.numMessages,
          style: writingStyleMatrix.style,
        })
        .from(writingStyleMatrix)
        .where(eq(writingStyleMatrix.connectionId, connectionId));

      if (existingMatrix) {
        const newStyle = createUpdatedMatrixFromNewEmail(
          existingMatrix.numMessages,
          existingMatrix.style as WritingStyleMatrix,
          emailStyleMatrix,
        );

        await tx
          .update(writingStyleMatrix)
          .set({
            numMessages: existingMatrix.numMessages + 1,
            style: newStyle,
          })
          .where(eq(writingStyleMatrix.connectionId, connectionId));
      } else {
        const newStyle = initializeStyleMatrixFromEmail(emailStyleMatrix);

        await tx
          .insert(writingStyleMatrix)
          .values({
            connectionId,
            numMessages: 1,
            style: newStyle,
          })
          .onConflictDoNothing();
      }
    });
  }

  async findWritingStyleMatrix(
    connectionId: string,
  ): Promise<typeof writingStyleMatrix.$inferSelect | undefined> {
    return await this.db.query.writingStyleMatrix.findFirst({
      where: eq(writingStyleMatrix.connectionId, connectionId),
      columns: {
        numMessages: true,
        style: true,
        updatedAt: true,
        connectionId: true,
      },
    });
  }

  async deleteActiveConnection(userId: string, connectionId: string) {
    return await this.db
      .delete(connection)
      .where(and(eq(connection.userId, userId), eq(connection.id, connectionId)));
  }

  async updateConnection(
    userId: string,
    connectionId: string,
    updatingInfo: Partial<typeof connection.$inferInsert>,
  ) {
    return await this.db
      .update(connection)
      .set(updatingInfo)
      .where(and(eq(connection.id, connectionId), eq(connection.userId, userId)));
  }

  async findManyEmailTemplates(userId: string): Promise<(typeof emailTemplate.$inferSelect)[]> {
    return await this.db.query.emailTemplate.findMany({
      where: eq(emailTemplate.userId, userId),
      orderBy: desc(emailTemplate.updatedAt),
    });
  }

  async createEmailTemplate(
    userId: string,
    payload: Omit<typeof emailTemplate.$inferInsert, 'userId'>,
  ) {
    return await this.db
      .insert(emailTemplate)
      .values({
        ...payload,
        userId,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  }

  async deleteEmailTemplate(userId: string, templateId: string) {
    return await this.db
      .delete(emailTemplate)
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)));
  }

  async updateEmailTemplate(
    userId: string,
    templateId: string,
    data: Partial<typeof emailTemplate.$inferInsert>,
  ) {
    return await this.db
      .update(emailTemplate)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)))
      .returning();
  }
}

// Utility function to hash IP addresses for PII protection
function hashIpAddress(ip: string | undefined): string | undefined {
  if (!ip) return undefined;

  // Simple but effective hash for IP addresses
  // This preserves uniqueness while protecting PII
  const salt = 'zero-mail-ip-salt-2024'; // Consider using env variable for production
  let hash = 0;
  const str = ip + salt;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Return a prefixed hex representation
  return `ip_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

const api = new Hono<HonoContext>()
  .use(contextStorage())
  .use('*', async (c, next) => {
    // Initialize request tracing using headers (no context pollution)
    const traceId = c.req.header('X-Trace-ID') || crypto.randomUUID();
    const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();

    // Set trace ID in response headers for client correlation
    c.header('X-Trace-ID', traceId);
    c.header('X-Request-ID', requestId);

    // Store trace ID in context variables for TRPC access
    c.set('traceId', traceId);
    c.set('requestId', requestId);

    const { finalizeRequestTrace, TraceContext } = await import('./lib/trace-context');

    // Create trace for this request
    const rawIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For');
    const trace = TraceContext.createTrace(traceId, {
      requestId,
      ip: hashIpAddress(rawIp), // Hash IP address to protect PII
      userAgent: c.req.header('User-Agent'),
    });

    // Start authentication span
    const authSpan = TraceContext.startSpan(
      traceId,
      'authentication',
      {
        method: c.req.method,
        url: c.req.url,
        hasAuthHeader: !!c.req.header('Authorization'),
      },
      {
        'auth.method': c.req.header('Authorization') ? 'bearer_token' : 'session_cookie',
      },
    );

    await ensureConfiguredAdmin();
    const auth = createAuth();
    c.set('auth', auth);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('sessionUser', session?.user);

    if (c.req.header('Authorization') && !session?.user) {
      // Start token verification span
      const tokenSpan = TraceContext.startSpan(
        traceId,
        'token_verification',
        {
          tokenPresent: true,
        },
        {
          'auth.token_type': 'jwt',
        },
      );

      const token = c.req.header('Authorization')?.split(' ')[1];

      if (token) {
        try {
          const localJwks = await auth.api.getJwks();
          const jwks = createLocalJWKSet(localJwks);

          const { payload } = await jwtVerify(token, jwks);
          const userId = payload.sub;

          if (userId) {
            const db = await getZeroDB(userId);
            const user = await db.findUser();
            c.set('sessionUser', user);

            TraceContext.completeSpan(traceId, tokenSpan.id, {
              success: true,
              userId,
            });
          } else {
            TraceContext.completeSpan(traceId, tokenSpan.id, {
              success: false,
              reason: 'no_user_id_in_token',
            });
          }
        } catch (error) {
          TraceContext.completeSpan(
            traceId,
            tokenSpan.id,
            {
              success: false,
              reason: 'token_verification_failed',
            },
            error instanceof Error ? error.message : 'Unknown token error',
          );
        }
      } else {
        TraceContext.completeSpan(traceId, tokenSpan.id, {
          success: false,
          reason: 'no_token_provided',
        });
      }
    }

    // Complete auth span
    TraceContext.completeSpan(traceId, authSpan.id, {
      authenticated: !!c.var.sessionUser,
      userId: c.var.sessionUser?.id,
      authMethod: session?.user ? 'session' : c.req.header('Authorization') ? 'token' : 'none',
    });

    // Update trace metadata with user info
    trace.metadata.userId = c.var.sessionUser?.id;
    trace.metadata.sessionId = c.var.sessionUser?.id || 'anonymous';

    // Start request processing span
    const requestSpan = TraceContext.startSpan(traceId, 'request_processing', {
      authenticated: !!c.var.sessionUser,
      path: new URL(c.req.url).pathname,
    });

    let requestError: unknown;
    try {
      await next();
    } catch (error) {
      requestError = error;
      throw error;
    } finally {
      finalizeRequestTrace(c, requestSpan.id, c.res.status, requestError);
      c.set('sessionUser', undefined);
      c.set('auth', undefined as any);
    }
  })
  .route('/ai', aiRouter)
  .route('/public', publicRouter)
  .route('/api/integrations', integrationOAuthRouter)
  .on(['GET', 'POST', 'OPTIONS'], '/auth/*', (c) => {
    return c.var.auth.handler(c.req.raw);
  })
  .use(
    trpcServer({
      endpoint: '/api/trpc',
      router: appRouter,
      createContext: (_, c) => {
        return { c, sessionUser: c.var['sessionUser'], db: c.var['db'] };
      },
      allowMethodOverride: true,
      onError: (opts) => {
        console.error('Error in TRPC handler:', opts.error);
      },
    }),
  )
  .onError(async (err, c) => {
    if (err instanceof Response) return err;
    console.error('Error in Hono handler:', err);
    return c.json(
      {
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  });

const app = new Hono<HonoContext>()
  .use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return null;
        let hostname: string;
        try {
          hostname = new URL(origin).hostname;
        } catch {
          return null;
        }
        const cookieDomain = env.COOKIE_DOMAIN;
        if (!cookieDomain) return null;
        if (hostname === cookieDomain || hostname.endsWith('.' + cookieDomain)) {
          return origin;
        }
        return null;
      },
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Zero-Redirect'],
    }),
  )
  .get('.well-known/oauth-authorization-server', async (c) => {
    const auth = createAuth();
    return oAuthDiscoveryMetadata(auth)(c.req.raw);
  })
  .mount(
    '/sse',
    async (request, env, ctx) => {
      const authBearer = request.headers.get('Authorization');
      if (!authBearer) {
        console.log('No auth provided');
        return new Response('Unauthorized', { status: 401 });
      }
      const auth = createAuth();
      const session = await auth.api.getMcpSession({ headers: request.headers });
      if (!session) {
        console.log('Invalid auth provided', Array.from(request.headers.entries()));
        return new Response('Unauthorized', { status: 401 });
      }
      ctx.props = {
        userId: session?.userId,
      };
      return ZeroMCP.serveSSE('/sse', { binding: 'ZERO_MCP' }).fetch(request, env, ctx);
    },
    { replaceRequest: false },
  )
  .mount(
    '/mcp/thinking/sse',
    async (request, env, ctx) => {
      return ThinkingMCP.serveSSE('/mcp/thinking/sse', { binding: 'THINKING_MCP' }).fetch(
        request,
        env,
        ctx,
      );
    },
    { replaceRequest: false },
  )
  .mount(
    '/mcp',
    async (request, env, ctx) => {
      const authBearer = request.headers.get('Authorization');
      if (!authBearer) {
        return new Response('Unauthorized', { status: 401 });
      }
      const auth = createAuth();
      const session = await auth.api.getMcpSession({ headers: request.headers });
      if (!session) {
        console.log('Invalid auth provided', Array.from(request.headers.entries()));
        return new Response('Unauthorized', { status: 401 });
      }
      ctx.props = {
        userId: session?.userId,
      };
      return ZeroMCP.serve('/mcp', { binding: 'ZERO_MCP' }).fetch(request, env, ctx);
    },
    { replaceRequest: false },
  )
  .route('/api', api)
  .use(
    '*',
    agentsMiddleware({
      options: {
        onBeforeConnect: (c) => {
          if (!c.headers.get('Cookie')) {
            return new Response('Unauthorized', { status: 401 });
          }
        },
      },
    }),
  )
  .get('/health', (c) => c.json({ message: 'Zero Server is Up!' }))
  .get('/', (c) => c.redirect(`${env.VITE_PUBLIC_APP_URL}`))
  .post('/monitoring/sentry', async (c) => {
    try {
      const envelopeBytes = await c.req.arrayBuffer();
      const envelope = new TextDecoder().decode(envelopeBytes);
      const piece = envelope.split('\n')[0];
      const header = JSON.parse(piece);
      const dsn = new URL(header['dsn']);
      const project_id = dsn.pathname?.replace('/', '');

      if (dsn.hostname !== SENTRY_HOST) {
        throw new Error(`Invalid sentry hostname: ${dsn.hostname}`);
      }

      if (!project_id || !SENTRY_PROJECT_IDS.has(project_id)) {
        throw new Error(`Invalid sentry project id: ${project_id}`);
      }

      const upstream_sentry_url = `https://${SENTRY_HOST}/api/${project_id}/envelope/`;
      await fetch(upstream_sentry_url, {
        method: 'POST',
        body: envelopeBytes,
      });

      return c.json({}, { status: 200 });
    } catch (e) {
      console.error('error tunneling to sentry', e);
      return c.json({ error: 'error tunneling to sentry' }, { status: 500 });
    }
  })
  .post('/a8n/notify/:providerId', async (c) => {
    const tracer = initTracing();
    const span = tracer.startSpan('a8n_notify', {
      attributes: {
        'provider.id': c.req.param('providerId'),
        'notification.type': 'email_notification',
        'http.method': c.req.method,
        'http.url': c.req.url,
      },
    });

    try {
      if (!c.req.header('Authorization')) {
        span.setAttributes({ 'auth.status': 'missing' });
        return c.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const providerId = c.req.param('providerId');
      if (providerId === EProviders.google) {
        const body = await c.req.json<{ emailAddress?: string; historyId?: string }>();
        const subHeader = c.req.header('x-goog-pubsub-subscription-name');

        span.setAttributes({
          'history.id': body.historyId ?? 'missing',
          'subscription.name': subHeader || 'missing',
        });

        if (!subHeader) {
          console.log('[GOOGLE] no subscription header', body);
          span.setAttributes({ 'error.type': 'missing_subscription_header' });
          return c.json({}, { status: 200 });
        }
        const isValid = await verifyToken(c.req.header('Authorization')!.split(' ')[1]);
        if (!isValid) {
          console.log('[GOOGLE] invalid request', body);
          span.setAttributes({ 'auth.status': 'invalid' });
          return c.json({}, { status: 200 });
        }

        span.setAttributes({ 'auth.status': 'valid' });

        const handled = await handleGmailPush(body, {
          enqueue: (command) => env.MAIL_INGRESS_QUEUE.send(command),
        });
        span.setAttributes({
          'queue.message_sent': handled.accepted,
        });
        return c.json({ message: 'OK' }, { status: 200 });
      }
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
const handler = {
  async fetch(request: Request, env: ZeroEnv, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};

// const config: ResolveConfigFn = (env: ZeroEnv) => {
//   return {
//     exporter: {
//       url: env.OTEL_EXPORTER_OTLP_ENDPOINT || 'https://api.axiom.co/v1/traces',
//       headers: env.OTEL_EXPORTER_OTLP_HEADERS
//         ? Object.fromEntries(
//             env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((header: string) => {
//               const [key, value] = header.split('=');
//               return [key.trim(), value.trim()];
//             }),
//           )
//         : {},
//     },
//     service: {
//       name: env.OTEL_SERVICE_NAME || 'zero-email-server',
//       version: '1.0.0',
//     },
//   };
// };

export default class Entry extends WorkerEntrypoint<ZeroEnv> {
  async fetch(request: Request): Promise<Response> {
    return handler.fetch(request, this.env, this.ctx);
  }
  async queue(
    batch: MessageBatch<unknown> | { queue: string; messages: Array<{ body: IEmailSendBatch }> },
  ) {
    switch (true) {
      case batch.queue.startsWith('mail-ingress-queue'): {
        const messages = batch.messages as Message<unknown>[];
        await Promise.all(
          messages.map(async (message) => {
            try {
              const command = parseMailIngressCommand(message.body);
              await runMailIngressCommand(this.env, command);
              message.ack();
            } catch (error) {
              console.error('[MAIL_INGRESS_QUEUE] command failed', error);
              if (error instanceof MailSyncError && error.classification === 'permanent') {
                message.ack();
              } else {
                message.retry({ delaySeconds: 60 });
              }
            }
          }),
        );
        return;
      }
      case batch.queue.startsWith('subscribe-queue'): {
        console.log('batch', batch);
        const messages = batch.messages as Message<{
          connectionId: string;
          providerId: EProviders;
        }>[];
        await Promise.all(
          messages.map(async (msg) => {
            const connectionId = msg.body.connectionId;
            const providerId = msg.body.providerId;
            try {
              await enableBrainFunction({ id: connectionId, providerId });
            } catch (error) {
              console.error(
                `Failed to enable brain function for connection ${connectionId}:`,
                error,
              );
              msg.retry?.({ delaySeconds: 60 });
            }
          }),
        );
        console.log('[SUBSCRIBE_QUEUE] batch done');
        return;
      }
      case batch.queue.startsWith('send-email-queue'): {
        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const { messageId, connectionId, mail } = msg.body;

            const { pending_emails_status: statusKV, pending_emails_payload: payloadKV } = this
              .env as { pending_emails_status: KVNamespace; pending_emails_payload: KVNamespace };

            const status = await statusKV.get(messageId);
            if (status === 'cancelled') {
              console.log(`Email ${messageId} cancelled – skipping send.`);
              return;
            }

            let payload = mail;
            if (!payload) {
              const stored = await payloadKV.get(messageId);
              if (!stored) {
                console.error(`No payload found for scheduled email ${messageId}`);
                return;
              }
              payload = JSON.parse(stored);
            }

            const agent = await getZeroAgent(connectionId, this.ctx);
            try {
              if (Array.isArray((payload as any).attachments)) {
                const attachments = (payload as any).attachments;

                const processedAttachments = await Promise.all(
                  attachments.map(
                    async (att: SerializedAttachment | AttachmentFile, index: number) => {
                      if ('arrayBuffer' in att && typeof att.arrayBuffer === 'function') {
                        return { attachment: att as AttachmentFile, index };
                      } else {
                        const processed = toAttachmentFiles([att as SerializedAttachment]);
                        return { attachment: processed[0], index };
                      }
                    },
                  ),
                );

                const orderedAttachments = Array.from({ length: attachments.length });
                processedAttachments.forEach(({ attachment, index }) => {
                  orderedAttachments[index] = attachment;
                });

                (payload as any).attachments = orderedAttachments;
              }

              if ('draftId' in (payload as any) && (payload as any).draftId) {
                const { draftId, ...rest } = payload as any;
                await agent.stub.sendDraft(draftId, rest as any);
              } else {
                await agent.stub.create(payload as any);
              }

              await statusKV.delete(messageId);
              await payloadKV.delete(messageId);
              console.log(`Email ${messageId} sent successfully`);
            } catch (error) {
              console.error(`Failed to send scheduled email ${messageId}:`, error);
              await statusKV.delete(messageId);
              await payloadKV.delete(messageId);
            }
          }),
        );
        return;
      }
      case batch.queue.startsWith('thread-queue'): {
        const tracer = initTracing();

        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const span = tracer.startSpan('thread_queue_processing', {
              attributes: {
                'provider.id': msg.body.providerId,
                'history.id': msg.body.historyId,
                'subscription.name': msg.body.subscriptionName,
                'queue.name': batch.queue,
              },
            });

            try {
              const providerId = msg.body.providerId;
              const historyId = msg.body.historyId;
              const subscriptionName = msg.body.subscriptionName;

              const workflowRunner = env.WORKFLOW_RUNNER.get(env.WORKFLOW_RUNNER.newUniqueId());
              const result = await workflowRunner.runMainWorkflow({
                providerId,
                historyId,
                subscriptionName,
              });
              console.log('[THREAD_QUEUE] result', result);
              span.setAttributes({
                'workflow.result': typeof result === 'string' ? result : JSON.stringify(result),
                'workflow.success': true,
              });
            } catch (error) {
              console.error('Error running workflow', error);
              span.recordException(error as Error);
              span.setStatus({ code: 2, message: (error as Error).message });
            } finally {
              span.end();
            }
          }),
        );
        break;
      }
    }
  }
  async scheduled() {
    console.log('Running scheduled tasks...');

    await this.processScheduledEmails();

    await enqueueDueMailIngressWork(this.env);

    await this.processExpiredSubscriptions();
  }

  private async processScheduledEmails() {
    console.log('Checking for scheduled emails ready to be queued...');
    const { scheduled_emails: scheduledKV, send_email_queue } = this.env as {
      scheduled_emails: KVNamespace;
      send_email_queue: Queue<IEmailSendBatch>;
    };

    try {
      const now = Date.now();
      const twelveHoursFromNow = now + 12 * 60 * 60 * 1000;

      let cursor: string | undefined = undefined;
      const batchSize = 1000;

      do {
        const listResp: {
          keys: { name: string }[];
          cursor?: string;
        } = await scheduledKV.list({ cursor, limit: batchSize });
        cursor = listResp.cursor;

        for (const key of listResp.keys) {
          try {
            const scheduledData = await scheduledKV.get(key.name);
            if (!scheduledData) continue;

            const { messageId, connectionId, sendAt } = JSON.parse(scheduledData);

            if (sendAt <= twelveHoursFromNow) {
              const delaySeconds = Math.max(0, Math.floor((sendAt - now) / 1000));

              console.log(`Queueing scheduled email ${messageId} with ${delaySeconds}s delay`);

              const queueBody: IEmailSendBatch = {
                messageId,
                connectionId,
                sendAt,
              };

              await send_email_queue.send(queueBody, { delaySeconds });
              await scheduledKV.delete(key.name);

              console.log(`Successfully queued scheduled email ${messageId}`);
            }
          } catch (error) {
            console.error('Failed to process scheduled email key', key.name, error);
          }
        }
      } while (cursor);
    } catch (error) {
      console.error('Error processing scheduled emails:', error);
    }
  }

  private async processExpiredSubscriptions() {
    console.log('[SCHEDULED] Checking for expired subscriptions...');
    const { db, conn } = createDb(this.env.HYPERDRIVE.connectionString);
    const allAccounts = await db.query.connection.findMany({
      where: (fields, { eq, and }) =>
        and(eq(fields.status, 'connected'), eq(fields.channelId, 'gmail')),
    });
    await conn.end();
    console.log('[SCHEDULED] allAccounts', allAccounts.length);
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const expiredSubscriptions: Array<{ connectionId: string; providerId: EProviders }> = [];

    const nowTs = Date.now();

    const unsnoozeMap: Record<string, { threadIds: string[]; keyNames: string[] }> = {};

    let cursor: string | undefined = undefined;
    do {
      const listResp: {
        keys: { name: string; metadata?: { wakeAt?: string } }[];
        cursor?: string;
      } = await this.env.snoozed_emails.list({ cursor, limit: 1000 });
      cursor = listResp.cursor;

      for (const key of listResp.keys) {
        try {
          const wakeAtIso = key.metadata?.wakeAt as string | undefined;
          if (!wakeAtIso) continue;
          const wakeAt = new Date(wakeAtIso).getTime();
          if (wakeAt > nowTs) continue;

          const [threadId, connectionId] = key.name.split('__');
          if (!threadId || !connectionId) continue;

          if (!unsnoozeMap[connectionId]) {
            unsnoozeMap[connectionId] = { threadIds: [], keyNames: [] };
          }
          unsnoozeMap[connectionId].threadIds.push(threadId);
          unsnoozeMap[connectionId].keyNames.push(key.name);
        } catch (error) {
          console.error('Failed to prepare unsnooze for key', key.name, error);
        }
      }
    } while (cursor);

    // await Promise.all(
    //   Object.entries(unsnoozeMap).map(async ([connectionId, { threadIds, keyNames }]) => {
    //     try {
    //       const { stub: agent } = await getZeroAgent(connectionId, this.ctx);
    //       await agent.queue('unsnoozeThreadsHandler', { connectionId, threadIds, keyNames });
    //     } catch (error) {
    //       console.error('Failed to enqueue unsnooze tasks', { connectionId, threadIds, error });
    //     }
    //   }),
    // );

    await Promise.all(
      allAccounts.map(async ({ id, channelId }) => {
        const providerId = channelIdToProviderId(channelId);
        const lastSubscribed = await this.env.gmail_sub_age.get(`${id}__${providerId}`);

        if (lastSubscribed) {
          const subscriptionDate = new Date(lastSubscribed);
          if (subscriptionDate < fiveDaysAgo) {
            console.log(`[SCHEDULED] Found expired Google subscription for connection: ${id}`);
            expiredSubscriptions.push({ connectionId: id, providerId: providerId as EProviders });
          }
        } else {
          expiredSubscriptions.push({ connectionId: id, providerId: providerId as EProviders });
        }
      }),
    );

    // Send expired subscriptions to queue for renewal
    if (expiredSubscriptions.length > 0) {
      console.log(
        `[SCHEDULED] Sending ${expiredSubscriptions.length} expired subscriptions to renewal queue`,
      );
      await Promise.all(
        expiredSubscriptions.map(async ({ connectionId, providerId }) => {
          await this.env.subscribe_queue.send({ connectionId, providerId });
        }),
      );
    }

    console.log(
      `[SCHEDULED] Processed ${allAccounts.keys.length} accounts, found ${expiredSubscriptions.length} expired subscriptions`,
    );
  }
}

export {
  ZeroAgent,
  ZeroMCP,
  ZeroDB,
  ZeroDriver,
  ThinkingMCP,
  WorkflowRunner,
  ThreadSyncWorker,
  SyncThreadsWorkflow,
  SyncThreadsCoordinatorWorkflow,
  ShardRegistry,
};
