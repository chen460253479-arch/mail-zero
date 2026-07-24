import {
  authorizationBinding,
  channelIntegrationMapping,
  connection,
  integrationOAuthSession,
  systemIntegrationConfig,
} from '../../db/schema';
import {
  parsePublicConfig,
  type IntegrationKey,
  type IntegrationOAuthPurpose,
  type IntegrationPublicConfigMap,
} from './schemas';
import { and, count, eq, gt, isNull, lt } from 'drizzle-orm';
import type { MailChannelId } from '../mail-channel/types';
import type { DB } from '../../db';

export { parsePublicConfig } from './schemas';

export type SystemIntegrationRecord = typeof systemIntegrationConfig.$inferSelect;
export type OAuthSessionRecord = typeof integrationOAuthSession.$inferSelect;

export type SafeIntegration<K extends IntegrationKey = IntegrationKey> = {
  configured: true;
  key: K;
  publicConfig: IntegrationPublicConfigMap[K];
  secretConfigured: true;
  status: 'active' | 'error';
  validatedAt: Date;
};

export const toSafeIntegration = <K extends IntegrationKey>(
  record: SystemIntegrationRecord & { integrationKey: K },
): SafeIntegration<K> => ({
  configured: true,
  key: record.integrationKey,
  publicConfig: parsePublicConfig(record.integrationKey, record.publicConfig),
  secretConfigured: true,
  status: record.status,
  validatedAt: record.validatedAt,
});

export type SaveActiveIntegrationInput<K extends IntegrationKey = IntegrationKey> = {
  integrationKey: K;
  publicConfig: IntegrationPublicConfigMap[K];
  encryptedSecret: string;
  updatedBy: string;
  validatedAt: Date;
};

export type CreateOAuthSessionInput = {
  integrationKey: 'gmail_zero_oauth';
  purpose: IntegrationOAuthPurpose;
  encryptedPayload: string;
  stateHash: string;
  createdBy: string;
  expiresAt: Date;
  createdAt: Date;
};

export interface SystemIntegrationRepository {
  get<K extends IntegrationKey>(key: K): Promise<SystemIntegrationRecord | null>;
  saveActive<K extends IntegrationKey>(input: SaveActiveIntegrationInput<K>): Promise<void>;
  delete(key: IntegrationKey): Promise<void>;
  getMapping(
    channelId: MailChannelId,
    authSource: 'nango',
  ): Promise<typeof channelIntegrationMapping.$inferSelect | null>;
  setMapping(channelId: MailChannelId, authSource: 'nango', integrationId: string): Promise<void>;
  deleteMapping(channelId: MailChannelId, authSource: 'nango'): Promise<void>;
  countNangoBindings(providerConfigKey?: string): Promise<number>;
  countZeroOAuthBindings(channelId: MailChannelId): Promise<number>;
  listNangoReferences(): Promise<Array<{ integrationId: string; connectionId: string }>>;
  createOAuthSession(input: CreateOAuthSessionInput): Promise<string>;
  consumeOAuthSession(input: {
    stateHash: string;
    createdBy: string;
    purpose: IntegrationOAuthPurpose;
    now: Date;
  }): Promise<OAuthSessionRecord | null>;
  deleteOAuthSession(id: string): Promise<void>;
  deleteExpiredOAuthSessions(now: Date): Promise<void>;
}

export const createSystemIntegrationRepository = (db: DB): SystemIntegrationRepository => ({
  get: async (key) =>
    (await db.query.systemIntegrationConfig.findFirst({
      where: eq(systemIntegrationConfig.integrationKey, key),
    })) ?? null,

  saveActive: async (input) => {
    const now = new Date();
    await db
      .insert(systemIntegrationConfig)
      .values({
        id: crypto.randomUUID(),
        ...input,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemIntegrationConfig.integrationKey,
        set: {
          publicConfig: input.publicConfig,
          encryptedSecret: input.encryptedSecret,
          status: 'active',
          validatedAt: input.validatedAt,
          updatedBy: input.updatedBy,
          updatedAt: now,
        },
      });
  },

  delete: async (key) => {
    await db.delete(systemIntegrationConfig).where(eq(systemIntegrationConfig.integrationKey, key));
  },

  getMapping: async (channelId, authSource) =>
    (await db.query.channelIntegrationMapping.findFirst({
      where: and(
        eq(channelIntegrationMapping.channelId, channelId),
        eq(channelIntegrationMapping.authSource, authSource),
      ),
    })) ?? null,

  setMapping: async (channelId, authSource, integrationId) => {
    const now = new Date();
    await db
      .insert(channelIntegrationMapping)
      .values({
        id: crypto.randomUUID(),
        channelId,
        authSource,
        externalIntegrationId: integrationId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [channelIntegrationMapping.channelId, channelIntegrationMapping.authSource],
        set: { externalIntegrationId: integrationId, updatedAt: now },
      });
  },

  deleteMapping: async (channelId, authSource) => {
    await db
      .delete(channelIntegrationMapping)
      .where(
        and(
          eq(channelIntegrationMapping.channelId, channelId),
          eq(channelIntegrationMapping.authSource, authSource),
        ),
      );
  },

  countNangoBindings: async (providerConfigKey) => {
    const where = providerConfigKey
      ? and(
          eq(authorizationBinding.authSource, 'nango'),
          eq(authorizationBinding.nangoProviderConfigKey, providerConfigKey),
        )
      : eq(authorizationBinding.authSource, 'nango');
    const [result] = await db.select({ value: count() }).from(authorizationBinding).where(where);
    return result?.value ?? 0;
  },

  countZeroOAuthBindings: async (channelId) => {
    const [result] = await db
      .select({ value: count() })
      .from(authorizationBinding)
      .innerJoin(connection, eq(connection.id, authorizationBinding.connectionId))
      .where(
        and(eq(authorizationBinding.authSource, 'zero_oauth'), eq(connection.channelId, channelId)),
      );
    return result?.value ?? 0;
  },

  listNangoReferences: async () =>
    (
      await db
        .select({
          integrationId: authorizationBinding.nangoProviderConfigKey,
          connectionId: authorizationBinding.nangoConnectionId,
        })
        .from(authorizationBinding)
        .where(eq(authorizationBinding.authSource, 'nango'))
    ).flatMap(({ integrationId, connectionId }) =>
      integrationId && connectionId ? [{ integrationId, connectionId }] : [],
    ),

  createOAuthSession: async (input) => {
    const id = crypto.randomUUID();
    await db.insert(integrationOAuthSession).values({ id, ...input });
    return id;
  },

  consumeOAuthSession: async ({ stateHash, createdBy, purpose, now }) => {
    const [record] = await db
      .update(integrationOAuthSession)
      .set({ consumedAt: now })
      .where(
        and(
          eq(integrationOAuthSession.stateHash, stateHash),
          eq(integrationOAuthSession.createdBy, createdBy),
          eq(integrationOAuthSession.purpose, purpose),
          isNull(integrationOAuthSession.consumedAt),
          gt(integrationOAuthSession.expiresAt, now),
        ),
      )
      .returning();
    return record ?? null;
  },

  deleteOAuthSession: async (id) => {
    await db.delete(integrationOAuthSession).where(eq(integrationOAuthSession.id, id));
  },

  deleteExpiredOAuthSessions: async (now) => {
    await db.delete(integrationOAuthSession).where(lt(integrationOAuthSession.expiresAt, now));
  },
});
