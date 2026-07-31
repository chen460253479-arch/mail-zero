import type { BlobRecord, BlobRepository } from '@zero/mail-core';
import { and, asc, eq, ne, or } from 'drizzle-orm';

import { requireRow, runAdapter, type MailDatabase } from './database';
import { blob } from '../schema';

const mapBlob = (row: typeof blob.$inferSelect): BlobRecord => ({
  id: row.id as BlobRecord['id'],
  accountId: row.mailAccountId as BlobRecord['accountId'],
  kind: row.kind,
  sha256: row.sha256,
  sizeBytes: row.sizeBytes,
  contentType: row.contentType,
  objectKey: row.objectKey,
  status: row.status,
  createdAt: row.createdAt,
  readyAt: row.readyAt,
  deletedAt: row.deletedAt,
});

export const createBlobRepository = (db: MailDatabase): BlobRepository => ({
  findById: (accountId, id) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(blob)
        .where(and(eq(blob.mailAccountId, accountId), eq(blob.id, id)))
        .limit(1);
      return rows[0] === undefined ? null : mapBlob(rows[0]);
    }),
  findByObjectKeyExcluding: (accountId, objectKey, exclusion) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(blob)
        .where(
          and(
            eq(blob.mailAccountId, accountId),
            eq(blob.objectKey, objectKey),
            or(ne(blob.status, exclusion.status), ne(blob.contentType, exclusion.contentType)),
          ),
        )
        .orderBy(asc(blob.createdAt), asc(blob.id))
        .limit(1);
      return rows[0] === undefined ? null : mapBlob(rows[0]);
    }),
  findByDigest: (accountId, kind, sha256, sizeBytes) =>
    runAdapter(async () => {
      const rows = await db
        .select()
        .from(blob)
        .where(
          and(
            eq(blob.mailAccountId, accountId),
            eq(blob.kind, kind),
            eq(blob.sha256, sha256),
            eq(blob.sizeBytes, sizeBytes),
          ),
        )
        .orderBy(asc(blob.createdAt), asc(blob.id))
        .limit(1);
      return rows[0] === undefined ? null : mapBlob(rows[0]);
    }),
  listDeletingByContentType: (accountId, contentType, limit) =>
    runAdapter(async () =>
      (
        await db
          .select()
          .from(blob)
          .where(
            and(
              eq(blob.mailAccountId, accountId),
              eq(blob.status, 'deleting'),
              eq(blob.contentType, contentType),
            ),
          )
          .orderBy(asc(blob.createdAt), asc(blob.id))
          .limit(limit)
      ).map(mapBlob),
    ),
  listByAccount: (accountId) =>
    runAdapter(async () =>
      (
        await db
          .select()
          .from(blob)
          .where(eq(blob.mailAccountId, accountId))
          .orderBy(asc(blob.createdAt), asc(blob.id))
      ).map(mapBlob),
    ),
  insert: (record) =>
    runAdapter(async () => {
      const rows = await db
        .insert(blob)
        .values({ ...record, mailAccountId: record.accountId })
        .returning();
      return mapBlob(requireRow(rows, 'STORAGE_FAILURE'));
    }),
  update: (accountId, id, patch) =>
    runAdapter(async () => {
      const rows = await db
        .update(blob)
        .set(patch)
        .where(and(eq(blob.mailAccountId, accountId), eq(blob.id, id)))
        .returning();
      return mapBlob(requireRow(rows, 'BLOB_NOT_FOUND', id));
    }),
  delete: (accountId, id) =>
    runAdapter(async () => {
      await db.delete(blob).where(and(eq(blob.mailAccountId, accountId), eq(blob.id, id)));
    }),
});
