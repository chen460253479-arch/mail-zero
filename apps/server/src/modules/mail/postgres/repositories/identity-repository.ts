import type { IdentityRecord, IdentityRepository } from '@zero/mail-core';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { mailIdentity } from '../schema';

const mapIdentity = (row: typeof mailIdentity.$inferSelect): IdentityRecord => ({
  id: row.id as IdentityRecord['id'],
  accountId: row.mailAccountId as IdentityRecord['accountId'],
  name: row.name,
  email: row.email,
  replyTo: row.replyTo,
  isDefault: row.isDefault,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createIdentityRepository = (db: MailDatabase): IdentityRepository => ({
  findById: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(mailIdentity)
        .where(
          and(
            eq(mailIdentity.mailAccountId, accountId),
            eq(mailIdentity.id, id),
            isNull(mailIdentity.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] === undefined ? null : mapIdentity(rows[0]);
    }),
  existsOutsideAccount: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select({ id: mailIdentity.id })
        .from(mailIdentity)
        .where(
          and(
            eq(mailIdentity.id, id),
            ne(mailIdentity.mailAccountId, accountId),
            isNull(mailIdentity.deletedAt),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }),
  listByAccount: (accountId) =>
    runAdapter(async () =>
      (
        await db
          .select()
          .from(mailIdentity)
          .where(and(eq(mailIdentity.mailAccountId, accountId), isNull(mailIdentity.deletedAt)))
          .orderBy(asc(mailIdentity.createdAt), asc(mailIdentity.id))
      ).map(mapIdentity),
    ),
  insert: (record) =>
    runAdapter(async () => {
      const rows = await db
        .insert(mailIdentity)
        .values({ ...record, mailAccountId: record.accountId })
        .returning();
      return mapIdentity(requireRow(rows, 'STORAGE_FAILURE'));
    }),
  update: (accountId, id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(mailIdentity)
        .set(patch)
        .where(
          and(
            eq(mailIdentity.mailAccountId, accountId),
            eq(mailIdentity.id, id),
            isNull(mailIdentity.deletedAt),
          ),
        )
        .returning();
      return mapIdentity(requireRow(rows, 'IDENTITY_NOT_FOUND', id));
    }),
  delete: (accountId, id) =>
    runAdapter(async () => {
      await db
        .update(mailIdentity)
        .set({ deletedAt: sql`now()`, isDefault: false })
        .where(
          and(
            eq(mailIdentity.mailAccountId, accountId),
            eq(mailIdentity.id, id),
            isNull(mailIdentity.deletedAt),
          ),
        );
    }),
});
