import { getTableConfig, IndexedColumn, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { expectedLocations } from './helpers/schema-contract';
import * as schema from '../../src/db/schema';

describe('local mail schema', () => {
  it('uses stable PostgreSQL-safe names for every declared constraint', () => {
    for (const [exportName, table] of expectedLocations) {
      const config = getTableConfig(table);
      const names = [
        ...config.primaryKeys.map(({ name }) => name),
        ...config.uniqueConstraints.map((constraint) => constraint.getName()),
        ...config.foreignKeys.map((foreignKey) => foreignKey.getName()),
        ...config.checks.map(({ name }) => name),
      ];

      for (const name of names) {
        expect(name, `${exportName} has an unnamed constraint`).toEqual(expect.any(String));
        if (typeof name !== 'string') continue;
        expect(
          Buffer.byteLength(name, 'utf8'),
          `${exportName}.${name} exceeds PostgreSQL's 63-byte identifier limit`,
        ).toBeLessThanOrEqual(63);
      }
      const named = names.filter((name): name is string => typeof name === 'string');
      expect(new Set(named).size, `${exportName} has duplicate constraint names`).toBe(
        named.length,
      );
    }

    expect(
      getTableConfig(schema.connection).uniqueConstraints.map((constraint) => constraint.getName()),
    ).toContain('connection_user_channel_email_uidx');
    expect(
      getTableConfig(schema.authorizationBinding).uniqueConstraints.map((constraint) =>
        constraint.getName(),
      ),
    ).toContain('authorization_binding_nango_ref_uidx');
    expect(
      getTableConfig(schema.channelIntegrationMapping).uniqueConstraints.map((constraint) =>
        constraint.getName(),
      ),
    ).toContain('channel_mapping_channel_auth_uidx');
    expect(getTableConfig(schema.writingStyleMatrix).primaryKeys.map(({ name }) => name)).toContain(
      'writing_style_matrix_pk',
    );
  });

  it.each([
    [
      'active Identity list',
      schema.mailIdentity,
      'mail_identity_account_created_active_idx',
      ['mail_account_id', 'created_at', 'id'],
      true,
    ],
    [
      'active Mailbox list',
      schema.mailbox,
      'mailbox_account_sort_active_idx',
      ['mail_account_id', 'sort_order', 'id'],
      true,
    ],
    [
      'Blob account list',
      schema.blob,
      'blob_account_created_id_idx',
      ['mail_account_id', 'created_at', 'id'],
      false,
    ],
    [
      'Submission account list',
      schema.emailSubmission,
      'email_submission_account_created_id_idx',
      ['mail_account_id', 'created_at', 'id'],
      false,
    ],
    [
      'Submission Identity list',
      schema.emailSubmission,
      'email_submission_account_identity_created_id_idx',
      ['mail_account_id', 'identity_id', 'created_at', 'id'],
      false,
    ],
    [
      'Email Blob FK',
      schema.email,
      'email_blob_account_idx',
      ['blob_id', 'mail_account_id'],
      false,
    ],
    [
      'Email Identity FK',
      schema.email,
      'email_identity_account_idx',
      ['identity_id', 'mail_account_id'],
      false,
    ],
    [
      'Email reply FK',
      schema.email,
      'email_reply_account_idx',
      ['reply_to_email_id', 'mail_account_id'],
      false,
    ],
    [
      'Email text Blob FK',
      schema.emailContent,
      'email_content_text_blob_account_idx',
      ['text_blob_id', 'mail_account_id'],
      false,
    ],
    [
      'Email HTML Blob FK',
      schema.emailContent,
      'email_content_html_blob_account_idx',
      ['html_blob_id', 'mail_account_id'],
      false,
    ],
    [
      'Email Part parent FK',
      schema.emailPart,
      'email_part_parent_email_account_idx',
      ['parent_part_id', 'email_id', 'mail_account_id'],
      false,
    ],
    [
      'Email Part Blob FK',
      schema.emailPart,
      'email_part_blob_account_idx',
      ['blob_id', 'mail_account_id'],
      false,
    ],
    [
      'Remote Email reverse FK',
      schema.remoteEmail,
      'remote_email_email_account_idx',
      ['email_id', 'mail_account_id'],
      false,
    ],
    [
      'Submission Email FK',
      schema.emailSubmission,
      'email_submission_email_account_idx',
      ['email_id', 'mail_account_id'],
      false,
    ],
    [
      'Submission Identity FK',
      schema.emailSubmission,
      'email_submission_identity_account_idx',
      ['identity_id', 'mail_account_id'],
      false,
    ],
  ] as const)(
    'declares supporting index %s',
    (_label, table, indexName, expectedColumns, partial) => {
      const tableIndex = getTableConfig(table).indexes.find(
        ({ config }) => config.name === indexName,
      );
      expect(tableIndex, indexName).toBeDefined();
      expect(
        tableIndex?.config.columns.map((column) =>
          column instanceof IndexedColumn ? column.name : undefined,
        ),
      ).toEqual([...expectedColumns]);
      expect(tableIndex?.config.where !== undefined).toBe(partial);
    },
  );

  it('does not duplicate primary-key coverage with ordinary indexes', () => {
    expect(
      getTableConfig(schema.mailChange).indexes.map(({ config }) => config.name),
    ).not.toContain('mail_change_account_state_collection_entity_idx');
    expect(
      getTableConfig(schema.threadReference).indexes.map(({ config }) => config.name),
    ).not.toContain('thread_reference_account_subject_message_idx');
    expect(
      getTableConfig(schema.connection).indexes.map(({ config }) => config.name),
    ).not.toContain('connection_user_id_idx');
    expect(
      getTableConfig(schema.authorizationBinding).indexes.map(({ config }) => config.name),
    ).not.toContain('authorization_connection_id_idx');
    expect(getTableConfig(schema.summary).indexes.map(({ config }) => config.name)).not.toContain(
      'summary_connection_id_idx',
    );
    expect(getTableConfig(schema.summary).indexes.map(({ config }) => config.name)).not.toContain(
      'summary_saved_idx',
    );
    expect(getTableConfig(schema.note).indexes.map(({ config }) => config.name)).not.toContain(
      'note_user_id_idx',
    );
    expect(getTableConfig(schema.note).indexes.map(({ config }) => config.name)).not.toContain(
      'note_is_pinned_idx',
    );
  });

  it('scopes legacy mail projections by Connection', () => {
    const summaryConfig = getTableConfig(schema.summary);
    expect(summaryConfig.columns.find(({ name }) => name === 'message_id')?.primary).toBe(false);
    expect(
      summaryConfig.primaryKeys
        .find(({ name }) => name === 'summary_pk')
        ?.columns.map(({ name }) => name),
    ).toEqual(['connection_id', 'message_id']);

    const noteConfig = getTableConfig(schema.note);
    expect(noteConfig.columns.map(({ name }) => name)).toContain('connection_id');
    expect(
      noteConfig.foreignKeys
        .find((foreignKey) => foreignKey.getName() === 'note_connection_fk')
        ?.reference()
        .columns.map(({ name }) => name),
    ).toEqual(['connection_id']);
    expect(
      noteConfig.indexes
        .find(({ config }) => config.name === 'note_user_connection_thread_idx')
        ?.config.columns.map((column) =>
          column instanceof IndexedColumn ? column.name : undefined,
        ),
    ).toEqual(['user_id', 'connection_id', 'thread_id']);
  });

  it('keeps provider credentials out of plugin-neutral Connections', () => {
    const connectionConfig = getTableConfig(schema.connection);
    const connectionColumns = connectionConfig.columns.map(({ name }) => name);

    expect(connectionColumns).toContain('provider_key');
    expect(connectionColumns).not.toEqual(
      expect.arrayContaining([
        'provider_id',
        'access_token',
        'refresh_token',
        'scope',
        'expires_at',
      ]),
    );
    expect(
      connectionConfig.uniqueConstraints
        .find(({ name }) => name === 'connection_user_channel_email_uidx')
        ?.columns.map(({ name }) => name),
    ).toEqual(['user_id', 'channel_id', 'normalized_email']);
    expect(connectionConfig.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['connection_status_chk', 'connection_provider_key_chk']),
    );
  });

  it('constrains stable Authorization Binding discriminators without OAuth-only requirements', () => {
    const authorizationConfig = getTableConfig(schema.authorizationBinding);
    const authorizationColumns = authorizationConfig.columns;

    expect(
      authorizationColumns.find(({ name }) => name === 'access_token_expires_at')?.notNull,
    ).toBe(false);
    expect(
      authorizationColumns.find(({ name }) => name === 'encrypted_credential_snapshot')?.notNull,
    ).toBe(false);
    expect(authorizationConfig.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'authorization_auth_source_chk',
        'authorization_credential_type_chk',
      ]),
    );
  });

  it('exports every local mail collection', () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        'mailAccount',
        'mailbox',
        'blob',
        'thread',
        'email',
        'emailAddress',
        'emailMailbox',
        'emailTrashRestore',
        'emailKeyword',
        'emailContent',
        'emailPart',
        'mailIdentity',
        'emailSubmission',
        'submissionBlob',
        'outboundDelivery',
        'sendAttempt',
        'remoteEmail',
        'mailChange',
        'emailSearch',
      ]),
    );
  });

  it('freezes Submission Blob references with account-composite foreign keys', () => {
    const config = getTableConfig(schema.submissionBlob);
    expect(config.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual(
      expect.arrayContaining([
        'submission_blob_submission_account_fk',
        'submission_blob_blob_account_fk',
      ]),
    );
    expect(config.uniqueConstraints.map((constraint) => constraint.getName())).toContain(
      'submission_blob_account_submission_kind_position_uidx',
    );
  });

  it('enforces account ownership, one default Identity, and one Blob digest row', () => {
    expect(
      getTableConfig(schema.connection).uniqueConstraints.map((constraint) => constraint.getName()),
    ).toContain('connection_id_user_id_uidx');

    const accountConfig = getTableConfig(schema.mailAccount);
    const ownership = accountConfig.foreignKeys.find(
      (foreignKey) => foreignKey.getName() === 'mail_account_connection_user_fk',
    );
    expect(ownership?.reference().columns.map(({ name }) => name)).toEqual([
      'connection_id',
      'user_id',
    ]);
    expect(ownership?.reference().foreignColumns.map(({ name }) => name)).toEqual([
      'id',
      'user_id',
    ]);

    const identityDefault = getTableConfig(schema.mailIdentity).indexes.find(
      ({ config }) => config.name === 'mail_identity_account_default_active_uidx',
    );
    expect(identityDefault?.config.unique).toBe(true);
    expect(identityDefault?.config.where).toBeDefined();

    const blobDigest = getTableConfig(schema.blob).indexes.find(
      ({ config }) => config.name === 'blob_account_sha_size_uidx',
    );
    expect(blobDigest?.config.unique).toBe(true);
  });

  it('persists Task 11 identity, reply, revision, retention, and search projection fields', () => {
    expect(getTableConfig(schema.mailAccount).columns.map(({ name }) => name)).toContain(
      'oldest_retained_state',
    );
    expect(getTableConfig(schema.email).columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['identity_id', 'reply_to_email_id']),
    );
    expect(getTableConfig(schema.emailSubmission).columns.map(({ name }) => name)).toContain(
      'draft_revision',
    );
    expect(getTableConfig(schema.mailIdentity).columns.map(({ name }) => name)).toContain(
      'deleted_at',
    );

    const searchConfig = getTableConfig(schema.emailSearch);
    expect(searchConfig.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['mail_account_id', 'email_id', 'document']),
    );
    expect(
      searchConfig.indexes.find(({ config }) => config.name === 'email_search_document_gin_idx')
        ?.config.method,
    ).toBe('gin');
  });

  it('persists every ordered Message-ID header value', () => {
    expect(schema.email.inReplyTo.getSQLType()).toBe('text[]');
    expect(schema.email.references.getSQLType()).toBe('text[]');
  });

  it('persists and indexes normalized Email query fields', () => {
    const emailConfig = getTableConfig(schema.email);
    const addressConfig = getTableConfig(schema.emailAddress);
    expect(emailConfig.columns.map(({ name }) => name)).toContain('normalized_subject');
    expect(addressConfig.columns.map(({ name }) => name)).toContain('normalized_email');
    expect(emailConfig.indexes.map(({ config }) => config.name)).toEqual(
      expect.arrayContaining([
        'email_account_sent_id_idx',
        'email_account_size_id_idx',
        'email_account_normalized_subject_id_idx',
      ]),
    );
    expect(addressConfig.indexes.map(({ config }) => config.name)).toContain(
      'email_address_account_normalized_kind_email_idx',
    );
  });

  it.each([
    [
      'Account',
      schema.mailAccount,
      [
        'mail_account_status_check',
        'mail_account_state_nonnegative_check',
        'mail_account_retention_floor_check',
        'mail_account_quota_nonnegative_check',
      ],
    ],
    [
      'Blob',
      schema.blob,
      ['blob_status_check', 'blob_size_nonnegative_check', 'blob_lifecycle_check'],
    ],
    [
      'Email',
      schema.email,
      [
        'email_lifecycle_check',
        'email_size_nonnegative_check',
        'email_draft_revision_nonnegative_check',
      ],
    ],
    [
      'Mailbox',
      schema.mailbox,
      ['mailbox_kind_check', 'mailbox_role_check', 'mailbox_counters_nonnegative_check'],
    ],
    [
      'Thread',
      schema.thread,
      ['thread_counters_nonnegative_check', 'thread_unread_within_total_check'],
    ],
    [
      'Submission',
      schema.emailSubmission,
      ['email_submission_status_check', 'email_submission_draft_revision_nonnegative_check'],
    ],
    [
      'Attempt',
      schema.sendAttempt,
      [
        'send_attempt_kind_chk',
        'send_attempt_outcome_chk',
        'send_attempt_number_positive_chk',
        'send_attempt_lifecycle_chk',
      ],
    ],
    [
      'Change',
      schema.mailChange,
      [
        'mail_change_collection_check',
        'mail_change_type_check',
        'mail_change_state_positive_check',
      ],
    ],
  ] as const)('declares %s lifecycle and numeric constraints', (_label, table, expected) => {
    expect(getTableConfig(table).checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([...expected]),
    );
  });

  it.each([
    ['Email Mailbox', schema.emailMailbox],
    ['Email restore Mailbox', schema.emailTrashRestore],
    ['Email Keyword', schema.emailKeyword],
    ['Email Part', schema.emailPart],
  ])('persists %s relation order', (_label, table) => {
    expect(getTableConfig(table).columns.map(({ name }) => name)).toContain('position');
  });

  it('scopes email part parent relationships to the same email', () => {
    const config = getTableConfig(schema.emailPart);
    const parentForeignKey = config.foreignKeys.find(
      (foreignKey) => foreignKey.getName() === 'email_part_parent_account_fk',
    );
    const parentReference = parentForeignKey?.reference();
    const parentUniqueKey = config.uniqueConstraints.find(
      (constraint) => constraint.getName() === 'email_part_id_email_account_uidx',
    );

    expect(parentReference?.columns.map((column) => column.name)).toEqual([
      'parent_part_id',
      'email_id',
      'mail_account_id',
    ]);
    expect(parentReference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
      'email_id',
      'mail_account_id',
    ]);
    expect(parentUniqueKey?.columns.map((column) => column.name)).toEqual([
      'id',
      'email_id',
      'mail_account_id',
    ]);
  });

  it('uniquely indexes active root mailbox names within an account', () => {
    const config = getTableConfig(schema.mailbox);
    const rootNameIndex = config.indexes.find(
      (tableIndex) => tableIndex.config.name === 'mailbox_active_root_name_uidx',
    );

    expect(rootNameIndex?.config.unique).toBe(true);
    expect(
      rootNameIndex?.config.columns.map((column) =>
        column instanceof IndexedColumn ? column.name : undefined,
      ),
    ).toEqual(['mail_account_id', 'normalized_name']);

    const predicate = rootNameIndex?.config.where;
    expect(predicate).toBeDefined();
    expect(new PgDialect().sqlToQuery(predicate!).sql).toContain(
      '"mail"."mailbox"."parent_id" IS NULL AND "mail"."mailbox"."deleted_at" IS NULL',
    );
  });
});
