import { getTableConfig, IndexedColumn, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema';

describe('local mail schema', () => {
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
        'submissionAttempt',
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
      ['email_submission_status_check', 'email_submission_counters_nonnegative_check'],
    ],
    [
      'Attempt',
      schema.submissionAttempt,
      [
        'submission_attempt_outcome_check',
        'submission_attempt_number_positive_check',
        'submission_attempt_lifecycle_check',
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
      '"mail0_mailbox"."parent_id" IS NULL AND "mail0_mailbox"."deleted_at" IS NULL',
    );
  });
});
