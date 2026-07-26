import {
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  unique,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { appSchema, authSchema, integrationSchema } from './pg-schemas';
import type { MailChannelId } from '../lib/mail-channel/types';
import { defaultUserSettings } from '../lib/schemas';
import { sql } from 'drizzle-orm';

const createAuthTable = authSchema.table;
const createAppTable = appSchema.table;
const createIntegrationTable = integrationSchema.table;

export const user = createAuthTable('user_account', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  role: text('role').notNull().default('admin'),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  defaultConnectionId: text('default_connection_id'),
  customPrompt: text('custom_prompt'),
  phoneNumber: text('phone_number').unique(),
  phoneNumberVerified: boolean('phone_number_verified'),
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
      .$type<'connected' | 'disconnected' | 'reconnect_required' | 'deleting'>()
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
    index('connection_provider_key_idx').on(t.providerKey),
    check(
      'connection_status_chk',
      sql`${t.status} IN ('connected', 'disconnected', 'reconnect_required', 'deleting')`,
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
  ],
);

export const systemIntegrationConfig = createIntegrationTable(
  'system_config',
  {
    id: text('id').primaryKey(),
    integrationKey: text('integration_key')
      .$type<'nango' | 'gmail_zero_oauth'>()
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
    check('system_integration_key_chk', sql`${t.integrationKey} IN ('nango', 'gmail_zero_oauth')`),
    check('system_integration_status_chk', sql`${t.status} IN ('active', 'error')`),
  ],
);

export const channelIntegrationMapping = createIntegrationTable(
  'channel_mapping',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').$type<MailChannelId>().notNull(),
    authSource: text('auth_source').$type<'nango'>().notNull(),
    externalIntegrationId: text('external_integration_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('channel_mapping_channel_auth_uidx').on(t.channelId, t.authSource),
    check('channel_mapping_auth_source_chk', sql`${t.authSource} = 'nango'`),
  ],
);

export const integrationOAuthSession = createIntegrationTable(
  'oauth_session',
  {
    id: text('id').primaryKey(),
    integrationKey: text('integration_key').$type<'gmail_zero_oauth'>().notNull(),
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
    check('oauth_session_integration_key_chk', sql`${t.integrationKey} = 'gmail_zero_oauth'`),
    check('oauth_session_purpose_chk', sql`${t.purpose} IN ('validate_config', 'connect_mailbox')`),
  ],
);

export const summary = createAppTable(
  'summary',
  {
    messageId: text('message_id').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    saved: boolean('saved').notNull().default(false),
    tags: text('tags'),
    suggestedReply: text('suggested_reply'),
  },
  (t) => [
    primaryKey({ name: 'summary_pk', columns: [t.connectionId, t.messageId] }),
    index('summary_connection_id_saved_idx').on(t.connectionId, t.saved),
  ],
);

// Testing
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

export const writingStyleMatrix = createAppTable(
  'writing_style_matrix',
  {
    connectionId: text()
      .notNull()
      .references(() => connection.id, { onDelete: 'cascade' }),
    numMessages: integer().notNull(),
    // TODO: way too much pain to get this type to work,
    // revisit later
    style: jsonb().$type<unknown>().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => {
    return [
      primaryKey({
        name: 'writing_style_matrix_pk',
        columns: [table.connectionId],
      }),
      index('writing_style_matrix_style_idx').on(table.style),
    ];
  },
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

export const oauthApplication = createAuthTable(
  'oauth_application',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    icon: text('icon'),
    metadata: text('metadata'),
    clientId: text('client_id').unique(),
    clientSecret: text('client_secret'),
    redirectURLs: text('redirect_u_r_ls'),
    type: text('type'),
    disabled: boolean('disabled'),
    userId: text('user_id'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('oauth_application_user_id_idx').on(t.userId),
    index('oauth_application_disabled_idx').on(t.disabled),
  ],
);

export const oauthAccessToken = createAuthTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    accessToken: text('access_token').unique(),
    refreshToken: text('refresh_token').unique(),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    clientId: text('client_id'),
    userId: text('user_id'),
    scopes: text('scopes'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('oauth_access_token_user_id_idx').on(t.userId),
    index('oauth_access_token_client_id_idx').on(t.clientId),
    index('oauth_access_token_expires_at_idx').on(t.accessTokenExpiresAt),
  ],
);

export const oauthConsent = createAuthTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id'),
    userId: text('user_id'),
    scopes: text('scopes'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    consentGiven: boolean('consent_given'),
  },
  (t) => [
    index('oauth_consent_user_id_idx').on(t.userId),
    index('oauth_consent_client_id_idx').on(t.clientId),
    index('oauth_consent_given_idx').on(t.consentGiven),
  ],
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
export { appSchema, authSchema, integrationSchema, mailSchema } from './pg-schemas';
