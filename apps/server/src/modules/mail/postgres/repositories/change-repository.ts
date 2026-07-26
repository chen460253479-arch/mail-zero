import {
  mergeMailChanges,
  type ChangeRepository,
  type MailChangeRecord,
  type QueryChangesInput,
} from '@zero/mail-core';
import { and, asc, eq, gt, lte, type SQL } from 'drizzle-orm';

import { runAdapter, type MailDatabase } from './database';
import { mailAccount, mailChange } from '../schema';

const mapChange = (row: typeof mailChange.$inferSelect): MailChangeRecord => ({
  accountId: row.mailAccountId as MailChangeRecord['accountId'],
  stateVersion: row.stateVersion,
  collection: row.collection,
  entityId: row.entityId,
  changeType: row.changeType,
  changedProperties: row.changedProperties,
  createdAt: row.createdAt,
});

const predicates = (input: QueryChangesInput): SQL[] => [
  eq(mailChange.mailAccountId, input.accountId),
  ...(input.collection === undefined ? [] : [eq(mailChange.collection, input.collection)]),
  ...(input.afterState === undefined ? [] : [gt(mailChange.stateVersion, input.afterState)]),
  ...(input.throughState === undefined ? [] : [lte(mailChange.stateVersion, input.throughState)]),
];

const ordered = (db: MailDatabase, input: QueryChangesInput) =>
  db
    .select()
    .from(mailChange)
    .where(and(...predicates(input)))
    .orderBy(asc(mailChange.stateVersion), asc(mailChange.collection), asc(mailChange.entityId));

export const createChangeRepository = (db: MailDatabase): ChangeRepository => ({
  recordChange: (record) =>
    runAdapter(async () => {
      const key = and(
        eq(mailChange.mailAccountId, record.accountId),
        eq(mailChange.stateVersion, record.stateVersion),
        eq(mailChange.collection, record.collection),
        eq(mailChange.entityId, record.entityId),
      );
      const existing = await db.select().from(mailChange).where(key).limit(1);
      if (existing[0] === undefined) {
        await db.insert(mailChange).values({
          ...record,
          mailAccountId: record.accountId,
        });
        return;
      }
      const merged = mergeMailChanges(mapChange(existing[0]), record);
      await db
        .update(mailChange)
        .set({
          changeType: merged.changeType,
          changedProperties: merged.changedProperties,
          createdAt: merged.createdAt,
        })
        .where(key);
    }),
  oldestAvailableState: (accountId) =>
    runAdapter(async () => {
      const rows = await db
        .select({ state: mailAccount.oldestRetainedState })
        .from(mailAccount)
        .where(eq(mailAccount.id, accountId))
        .limit(1);
      return rows[0]?.state ?? 0n;
    }),
  queryChanges: (input) =>
    runAdapter(async () => {
      if (input.limit === undefined) {
        return (await ordered(db, input)).map(mapChange);
      }
      const prefix = await ordered(db, input).limit(input.limit);
      if (prefix.length < input.limit) {
        return prefix.map(mapChange);
      }
      const cutoff = prefix.at(-1)!.stateVersion;
      const cutoffGroup = await db
        .select()
        .from(mailChange)
        .where(and(...predicates(input), eq(mailChange.stateVersion, cutoff)))
        .orderBy(asc(mailChange.collection), asc(mailChange.entityId));
      return [...prefix.filter(({ stateVersion }) => stateVersion < cutoff), ...cutoffGroup].map(
        mapChange,
      );
    }),
  hasChanges: (input) =>
    runAdapter(async () => {
      const rows = await db
        .select({ entityId: mailChange.entityId })
        .from(mailChange)
        .where(and(...predicates(input)))
        .limit(1);
      return rows.length > 0;
    }),
});
