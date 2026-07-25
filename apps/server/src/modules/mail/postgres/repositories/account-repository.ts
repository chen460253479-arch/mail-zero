import type { AccountRepository, InsertMailAccount, MailAccountRecord } from '@zero/mail-core';
import { eq } from 'drizzle-orm';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { mailAccount } from '../schema';

const mapAccount = (row: typeof mailAccount.$inferSelect): MailAccountRecord => ({
  id: row.id as MailAccountRecord['id'],
  userId: row.userId,
  connectionId: row.connectionId,
  status: row.status,
  stateVersion: row.stateVersion,
  timezone: row.timezone,
  storageQuotaBytes: row.storageQuotaBytes,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createAccountRepository = (db: MailDatabase): AccountRepository => ({
  findById: (id) =>
    runAdapter(async () => {
      const rows = await db.select().from(mailAccount).where(eq(mailAccount.id, id)).limit(1);
      return rows[0] === undefined ? null : mapAccount(rows[0]);
    }),
  findByConnectionId: (connectionId) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(mailAccount)
        .where(eq(mailAccount.connectionId, connectionId))
        .limit(1);
      return rows[0] === undefined ? null : mapAccount(rows[0]);
    }),
  insert: (input: InsertMailAccount) =>
    runAdapter(async () => {
      const rows = await db.insert(mailAccount).values(input).returning();
      return mapAccount(requireRow(rows, 'STORAGE_FAILURE'));
    }),
  update: (id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(mailAccount)
        .set(patch)
        .where(eq(mailAccount.id, id))
        .returning();
      return mapAccount(requireRow(rows, 'ACCOUNT_NOT_FOUND', id));
    }),
});
