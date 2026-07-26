import { getTableConfig, IndexedColumn, PgDialect } from 'drizzle-orm/pg-core';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';

import * as schema from '../../../src/db/schema';

export const expectedLocations = [
  ['user', schema.user, 'auth', 'user_account'],
  ['session', schema.session, 'auth', 'session'],
  ['account', schema.account, 'auth', 'account'],
  ['verification', schema.verification, 'auth', 'verification'],
  ['jwks', schema.jwks, 'auth', 'jwks'],
  ['oauthApplication', schema.oauthApplication, 'auth', 'oauth_application'],
  ['oauthAccessToken', schema.oauthAccessToken, 'auth', 'oauth_access_token'],
  ['oauthConsent', schema.oauthConsent, 'auth', 'oauth_consent'],
  ['earlyAccess', schema.earlyAccess, 'app', 'early_access'],
  ['userHotkeys', schema.userHotkeys, 'app', 'user_hotkeys'],
  ['summary', schema.summary, 'app', 'summary'],
  ['note', schema.note, 'app', 'note'],
  ['userSettings', schema.userSettings, 'app', 'user_settings'],
  ['writingStyleMatrix', schema.writingStyleMatrix, 'app', 'writing_style_matrix'],
  ['emailTemplate', schema.emailTemplate, 'app', 'email_template'],
  ['connection', schema.connection, 'integration', 'connection'],
  ['authorizationBinding', schema.authorizationBinding, 'integration', 'authorization_binding'],
  ['systemIntegrationConfig', schema.systemIntegrationConfig, 'integration', 'system_config'],
  ['channelIntegrationMapping', schema.channelIntegrationMapping, 'integration', 'channel_mapping'],
  ['integrationOAuthSession', schema.integrationOAuthSession, 'integration', 'oauth_session'],
  ['remoteEmail', schema.remoteEmail, 'integration', 'remote_email'],
  ['submissionAttempt', schema.submissionAttempt, 'integration', 'send_attempt'],
  ['mailAccount', schema.mailAccount, 'mail', 'account'],
  ['mailIdentity', schema.mailIdentity, 'mail', 'identity'],
  ['blob', schema.blob, 'mail', 'blob'],
  ['mailChange', schema.mailChange, 'mail', 'change'],
  ['email', schema.email, 'mail', 'email'],
  ['emailSearch', schema.emailSearch, 'mail', 'email_search'],
  ['emailAddress', schema.emailAddress, 'mail', 'email_address'],
  ['emailMailbox', schema.emailMailbox, 'mail', 'email_mailbox'],
  ['emailTrashRestore', schema.emailTrashRestore, 'mail', 'email_trash_restore'],
  ['emailKeyword', schema.emailKeyword, 'mail', 'email_keyword'],
  ['emailContent', schema.emailContent, 'mail', 'email_content'],
  ['emailPart', schema.emailPart, 'mail', 'email_part'],
  ['mailboxThread', schema.mailboxThread, 'mail', 'mailbox_thread'],
  ['mailbox', schema.mailbox, 'mail', 'mailbox'],
  ['emailSubmission', schema.emailSubmission, 'mail', 'submission'],
  ['submissionBlob', schema.submissionBlob, 'mail', 'submission_blob'],
  ['threadReference', schema.threadReference, 'mail', 'thread_reference'],
  ['thread', schema.thread, 'mail', 'thread'],
] as const;

const dialect = new PgDialect();

const normalizeSql = (
  value: SQL | undefined,
  schemaName: string | undefined,
  tableName: string,
): string | undefined => {
  if (value === undefined) return undefined;
  const tablePrefix =
    schemaName === undefined ? `"${tableName}"` : `"${schemaName}"."${tableName}"`;
  return dialect.sqlToQuery(value).sql.replaceAll(tablePrefix, '"<table>"');
};

const serializeDefault = (
  value: unknown,
  schemaName: string | undefined,
  tableName: string,
): string | undefined => {
  if (value === undefined) return undefined;
  if (value instanceof SQL) return normalizeSql(value, schemaName, tableName);
  return JSON.stringify(value);
};

export const collectStructuralSchemaShape = () => {
  const exportByTable = new Map<AnyPgTable, string>(
    expectedLocations.map(([name, table]) => [table, name]),
  );

  return Object.fromEntries(
    expectedLocations.map(([exportName, table]) => {
      const config = getTableConfig(table);
      return [
        exportName,
        {
          columns: config.columns.map((column) => ({
            name: column.name,
            sqlType: column.getSQLType(),
            notNull: column.notNull,
            primary: column.primary,
            unique: column.isUnique,
            defaultValue: serializeDefault(column.default, config.schema, config.name),
            hasRuntimeDefault: column.defaultFn !== undefined || column.onUpdateFn !== undefined,
          })),
          primaryKeys: config.primaryKeys.map((key) => key.columns.map(({ name }) => name)),
          uniqueConstraints: config.uniqueConstraints.map((constraint) =>
            constraint.columns.map(({ name }) => name),
          ),
          foreignKeys: config.foreignKeys.map((foreignKey) => {
            const reference = foreignKey.reference();
            const foreignTableExport = exportByTable.get(reference.foreignTable);
            if (foreignTableExport === undefined) {
              throw new Error(`Unknown foreign table from ${exportName}`);
            }
            return {
              columns: reference.columns.map(({ name }) => name),
              foreignTableExport,
              foreignColumns: reference.foreignColumns.map(({ name }) => name),
              onDelete: foreignKey.onDelete,
              onUpdate: foreignKey.onUpdate,
            };
          }),
          indexes: config.indexes.map(({ config: indexConfig }) => ({
            columns: indexConfig.columns.map((column) =>
              column instanceof IndexedColumn ? column.name : null,
            ),
            unique: indexConfig.unique,
            method: indexConfig.method,
            where: normalizeSql(indexConfig.where, config.schema, config.name),
          })),
          checks: config.checks.map(({ value }) => normalizeSql(value, config.schema, config.name)),
        },
      ];
    }),
  );
};
