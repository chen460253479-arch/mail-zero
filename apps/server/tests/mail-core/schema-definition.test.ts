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
        'submissionAttempt',
        'remoteEmail',
        'mailChange',
      ]),
    );
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
