import {
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { appSchema, authSchema, integrationSchema } from './pg-schemas';
import type { MailChannelId } from '../mail-channel/contracts';
import { defaultUserSettings } from '../lib/schemas';
import { sql } from 'drizzle-orm';

// Core tables must not import the aggregate schema module. Mail-domain schemas
// depend on these definitions, while the aggregate module re-exports both.
const createAuthTable = authSchema.table;
const createAppTable = appSchema.table;
const createIntegrationTable = integrationSchema.table;

export const user = createAuthTable('user_account', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  role: text('role').notNull().default('user'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  defaultConnectionId: text('default_connection_id'),
});

export const session = createAuthTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('session_user_id_idx').on(t.userId),
    index('session_expires_at_idx').on(t.expiresAt),
  ],
);

export const account = createAuthTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('account_user_id_idx').on(t.userId),
    index('account_provider_user_id_idx').on(t.providerId, t.userId),
    index('account_expires_at_idx').on(t.accessTokenExpiresAt),
  ],
);

export const userHotkeys = createAppTable(
  'user_hotkeys',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    shortcuts: jsonb('shortcuts').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('user_hotkeys_shortcuts_idx').on(t.shortcuts)],
);

export const verification = createAuthTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('verification_identifier_idx').on(t.identifier),
    index('verification_expires_at_idx').on(t.expiresAt),
  ],
);

export const earlyAccess = createAppTable(
  'early_access',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    isEarlyAccess: boolean('is_early_access').notNull().default(false),
    hasUsedTicket: text('has_used_ticket').default(''),
  },
  (t) => [index('early_access_is_early_access_idx').on(t.isEarlyAccess)],
);

export const connection = createIntegrationTable(
  'connection',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    normalizedEmail: text('normalized_email').notNull(),
    name: text('name'),
    picture: text('picture'),
    channelId: text('channel_id').$type<MailChannelId>().notNull(),
    status: text('status')
      .$type<'connected' | 'disconnecting' | 'disconnected' | 'reconnect_required' | 'deleting'>()
      .notNull()
      .default('connected'),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    providerKey: text('provider_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('connection_user_channel_email_uidx').on(t.userId, t.channelId, t.normalizedEmail),
    unique('connection_id_user_id_uidx').on(t.id, t.userId),
    uniqueIndex('connection_channel_email_active_uidx')
      .on(t.channelId, t.normalizedEmail)
      .where(sql`${t.status} IN ('connected', 'disconnecting', 'reconnect_required', 'deleting')`),
    index('connection_provider_key_idx').on(t.providerKey),
    check(
      'connection_status_chk',
      sql`${t.status} IN ('connected', 'disconnecting', 'disconnected', 'reconnect_required', 'deleting')`,
    ),
    check(
      'connection_channel_id_chk',
      sql`${t.channelId} IN ('gmail', 'outlook', 'zoho_mail', 'imap_smtp')`,
    ),
    check(
      'connection_provider_key_chk',
      sql`${t.providerKey} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`,
    ),
  ],
);

export const authorizationBinding = createIntegrationTable(
  'authorization_binding',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .unique()
      .references(() => connection.id, { onDelete: 'cascade' }),
    authSource: text('auth_source').$type<'zero_oauth' | 'nango' | 'manual'>().notNull(),
    credentialType: text('credential_type').$type<'oauth2' | 'basic' | 'custom'>().notNull(),
    encryptedCredentialSnapshot: text('encrypted_credential_snapshot'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    credentialFetchedAt: timestamp('credential_fetched_at', { withTimezone: true }),
    nangoConnectionId: text('nango_connection_id'),
    nangoProviderConfigKey: text('nango_provider_config_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('authorization_binding_nango_ref_uidx').on(
      t.nangoProviderConfigKey,
      t.nangoConnectionId,
    ),
    check(
      'authorization_auth_source_chk',
      sql`${t.authSource} IN ('zero_oauth', 'nango', 'manual')`,
    ),
    check(
      'authorization_credential_type_chk',
      sql`${t.credentialType} IN ('oauth2', 'basic', 'custom')`,
    ),
    check(
      'authorization_nango_reference_chk',
      sql`(
        ${t.authSource} = 'nango'
        AND ${t.nangoConnectionId} IS NOT NULL
        AND ${t.nangoProviderConfigKey} IS NOT NULL
      ) OR (
        ${t.authSource} <> 'nango'
        AND ${t.nangoConnectionId} IS NULL
        AND ${t.nangoProviderConfigKey} IS NULL
      )`,
    ),
    check(
      'authorization_credential_material_chk',
      sql`(
        ${t.authSource} = 'nango'
      ) OR (
        ${t.authSource} = 'zero_oauth'
        AND ${t.credentialType} = 'oauth2'
        AND ${t.encryptedCredentialSnapshot} IS NOT NULL
      ) OR (
        ${t.authSource} = 'manual'
        AND ${t.credentialType} IN ('basic', 'custom')
        AND ${t.encryptedCredentialSnapshot} IS NOT NULL
        AND ${t.accessTokenExpiresAt} IS NULL
      )`,
    ),
  ],
);

export const systemIntegrationConfig = createIntegrationTable(
  'system_config',
  {
    id: text('id').primaryKey(),
    integrationKey: text('integration_key')
      .$type<'gmail_zero_oauth' | 'outlook_zero_oauth' | 'zoho_mail_zero_oauth'>()
      .notNull()
      .unique(),
    publicConfig: jsonb('public_config').notNull(),
    encryptedSecret: text('encrypted_secret').notNull(),
    status: text('status').$type<'active' | 'error'>().notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true }).notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'system_integration_key_chk',
      sql`${t.integrationKey} IN ('gmail_zero_oauth', 'outlook_zero_oauth', 'zoho_mail_zero_oauth')`,
    ),
    check('system_integration_status_chk', sql`${t.status} IN ('active', 'error')`),
  ],
);

export const channelConfig = createIntegrationTable(
  'channel_config',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').$type<MailChannelId>().notNull().unique(),
    authSource: text('auth_source').$type<'zero_oauth' | 'nango' | 'manual'>().notNull(),
    inboxWatchEnabled: boolean('inbox_watch_enabled').notNull().default(false),
    scheduledSyncEnabled: boolean('scheduled_sync_enabled').notNull().default(true),
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(10),
    providerConfig: jsonb('provider_config').$type<Record<string, unknown>>().notNull().default({}),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'channel_config_channel_id_chk',
      sql`${t.channelId} IN ('gmail', 'outlook', 'zoho_mail', 'imap_smtp')`,
    ),
    check(
      'channel_config_auth_source_chk',
      sql`${t.authSource} IN ('zero_oauth', 'nango', 'manual')`,
    ),
    check('channel_config_sync_interval_chk', sql`${t.syncIntervalMinutes} BETWEEN 1 AND 1440`),
  ],
);

export const integrationOAuthSession = createIntegrationTable(
  'oauth_session',
  {
    id: text('id').primaryKey(),
    integrationKey: text('integration_key')
      .$type<'gmail_zero_oauth' | 'outlook_zero_oauth' | 'zoho_mail_zero_oauth'>()
      .notNull(),
    purpose: text('purpose').$type<'validate_config' | 'connect_mailbox'>().notNull(),
    encryptedPayload: text('encrypted_payload').notNull(),
    stateHash: text('state_hash').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('integration_oauth_session_expires_at_idx').on(t.expiresAt),
    index('integration_oauth_session_created_by_idx').on(t.createdBy),
    check(
      'oauth_session_integration_key_chk',
      sql`${t.integrationKey} IN ('gmail_zero_oauth', 'outlook_zero_oauth', 'zoho_mail_zero_oauth')`,
    ),
    check('oauth_session_purpose_chk', sql`${t.purpose} IN ('validate_config', 'connect_mailbox')`),
  ],
);

export const note = createAppTable(
  'note',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').notNull(),
    threadId: text('thread_id').notNull(),
    content: text('content').notNull(),
    color: text('color').notNull().default('default'),
    isPinned: boolean('is_pinned').default(false),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'note_connection_fk',
      columns: [t.connectionId],
      foreignColumns: [connection.id],
    }).onDelete('cascade'),
    index('note_connection_id_idx').on(t.connectionId),
    index('note_user_connection_thread_idx').on(t.userId, t.connectionId, t.threadId),
  ],
);

export const userSettings = createAppTable(
  'user_settings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
      .unique(),
    settings: jsonb('settings')
      .$type<typeof defaultUserSettings>()
      .notNull()
      .default(defaultUserSettings),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('user_settings_settings_idx').on(t.settings)],
);

export const jwks = createAuthTable(
  'jwks',
  {
    id: text('id').primaryKey(),
    publicKey: text('public_key').notNull(),
    privateKey: text('private_key').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('jwks_created_at_idx').on(t.createdAt)],
);

export const emailTemplate = createAppTable(
  'email_template',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject'),
    body: text('body'),
    to: jsonb('to'),
    cc: jsonb('cc'),
    bcc: jsonb('bcc'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('email_template_user_id_idx').on(t.userId),
    unique('email_template_user_id_name_uidx').on(t.userId, t.name),
  ],
);

export * from '../modules/mail/postgres/schema';
export * from '../modules/mail-sync/postgres/schema';
export * from '../modules/mail-outbound/postgres/schema';
export * from '../modules/mail-snooze/postgres/schema';
export * from '../modules/mail-tasks/postgres/schema';
export { appSchema, authSchema, integrationSchema, mailSchema } from './pg-schemas';
