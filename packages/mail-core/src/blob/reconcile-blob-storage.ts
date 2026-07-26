import { MailCoreError, type BlobId, type MailAccountId } from '../types';
import type { BlobStoreEntry, MailCoreDependencies } from '../store';
import { contentAddressedObjectKey } from './blob-lifecycle';

const MAX_MAINTENANCE_BATCH = 1000;
const LIST_PAGE_SIZE = 1000;
const MAX_SCAN_PAGES_PER_KIND = 10;
const ORPHAN_RESERVATION_CONTENT_TYPE = 'application/x-zero-orphan-reservation';

export type ReconcileBlobStorageCursor = {
  object: {
    value: string | null;
    exhausted: boolean;
  };
  temporary: {
    value: string | null;
    exhausted: boolean;
  };
};

export type ReconcileBlobStorageInput = {
  accountId: MailAccountId;
  olderThan: Date;
  limit: number;
  cursor?: ReconcileBlobStorageCursor;
};

export type ReconcileBlobStorageResult = {
  deletedObjectCount: number;
  deletedTemporaryCount: number;
  cursor: ReconcileBlobStorageCursor;
};

type Candidate = BlobStoreEntry & {
  kind: 'object' | 'temporary';
  reservationId: BlobId | null;
};

const sha256FromObjectKey = (accountId: MailAccountId, objectKey: string): string => {
  const sha256 = objectKey.split('/').at(-1);
  if (
    sha256 === undefined ||
    !/^[0-9a-f]{64}$/u.test(sha256) ||
    contentAddressedObjectKey(accountId, sha256) !== objectKey
  ) {
    throw new MailCoreError('BLOB_INTEGRITY');
  }
  return sha256;
};

const scanCandidates = async (
  dependencies: MailCoreDependencies,
  accountId: MailAccountId,
  kind: Candidate['kind'],
  olderThan: Date,
  limit: number,
  initialCursor: ReconcileBlobStorageCursor[Candidate['kind']],
): Promise<{ entries: BlobStoreEntry[]; cursor: string | null; exhausted: boolean }> => {
  if (limit === 0 || initialCursor.exhausted) {
    return {
      entries: [],
      cursor: initialCursor.value,
      exhausted: initialCursor.exhausted,
    };
  }

  const entries: BlobStoreEntry[] = [];
  const seenCursors = new Set<string>(initialCursor.value === null ? [] : [initialCursor.value]);
  let cursor = initialCursor.value;
  for (let pageNumber = 0; pageNumber < MAX_SCAN_PAGES_PER_KIND; pageNumber += 1) {
    const pageLimit = Math.min(LIST_PAGE_SIZE, limit - entries.length);
    let page;
    try {
      page = await dependencies.blobStore.list({
        accountId,
        kind,
        cursor,
        limit: pageLimit,
      });
    } catch {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    if (page.entries.length > pageLimit) {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    entries.push(...page.entries.filter((entry) => entry.uploadedAt < olderThan));
    if (page.cursor === null) {
      return { entries, cursor: null, exhausted: true };
    }
    if (seenCursors.has(page.cursor)) {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
    if (entries.length >= limit) {
      return { entries, cursor, exhausted: false };
    }
  }
  return { entries, cursor, exhausted: false };
};

export async function reconcileBlobStorage(
  dependencies: MailCoreDependencies,
  input: ReconcileBlobStorageInput,
): Promise<ReconcileBlobStorageResult> {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_MAINTENANCE_BATCH ||
    Number.isNaN(input.olderThan.getTime())
  ) {
    throw new MailCoreError('INVALID_GC_REQUEST');
  }

  try {
    const initialCursor = input.cursor ?? {
      object: { value: null, exhausted: false },
      temporary: { value: null, exhausted: false },
    };
    const pendingReservations = await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      return tx.blobs.listDeletingByContentType(
        input.accountId,
        ORPHAN_RESERVATION_CONTENT_TYPE,
        input.limit,
      );
    });
    const scanLimit = Math.max(0, input.limit - pendingReservations.length);
    const objectScan = await scanCandidates(
      dependencies,
      input.accountId,
      'object',
      input.olderThan,
      scanLimit,
      initialCursor.object,
    );
    const temporaryScan = await scanCandidates(
      dependencies,
      input.accountId,
      'temporary',
      input.olderThan,
      scanLimit,
      initialCursor.temporary,
    );

    const claimed = await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const now = dependencies.clock.now();
      const reservations = await tx.blobs.listDeletingByContentType(
        input.accountId,
        ORPHAN_RESERVATION_CONTENT_TYPE,
        input.limit,
      );
      const existingReservations: Candidate[] = [];
      for (const blob of reservations) {
        if (blob.readyAt === null || blob.deletedAt === null) {
          throw new MailCoreError('BLOB_INTEGRITY');
        }
        const sha256 = sha256FromObjectKey(input.accountId, blob.objectKey);
        if (blob.sha256 !== sha256) {
          throw new MailCoreError('BLOB_INTEGRITY');
        }
        const owner = await tx.blobs.findByObjectKeyExcluding(input.accountId, blob.objectKey, {
          status: 'deleting',
          contentType: ORPHAN_RESERVATION_CONTENT_TYPE,
        });
        if (owner !== null) {
          await tx.blobs.delete(input.accountId, blob.id);
          continue;
        }
        existingReservations.push({
          key: blob.objectKey,
          uploadedAt: blob.createdAt,
          sizeBytes: blob.sizeBytes,
          kind: 'object' as const,
          reservationId: blob.id,
        });
      }
      const existingReservationKeys = new Set(
        existingReservations.map((reservation) => reservation.key),
      );
      const eligibleObjectKeys = new Set<string>();
      const newObjects: Candidate[] = [];
      for (const entry of objectScan.entries) {
        const sha256 = sha256FromObjectKey(input.accountId, entry.key);
        const owner = await tx.blobs.findByObjectKeyExcluding(input.accountId, entry.key, {
          status: 'deleting',
          contentType: ORPHAN_RESERVATION_CONTENT_TYPE,
        });
        if (owner !== null) {
          continue;
        }
        const existing = await tx.blobs.findByDigest(input.accountId, sha256, entry.sizeBytes);
        if (existing === null) {
          eligibleObjectKeys.add(entry.key);
          newObjects.push({
            ...entry,
            kind: 'object' as const,
            reservationId: null,
          });
          continue;
        }
        if (
          existing.status === 'deleting' &&
          existing.contentType === ORPHAN_RESERVATION_CONTENT_TYPE
        ) {
          eligibleObjectKeys.add(entry.key);
          if (existingReservationKeys.has(existing.objectKey)) {
            continue;
          }
          if (existing.readyAt === null || existing.deletedAt === null) {
            throw new MailCoreError('BLOB_INTEGRITY');
          }
          existingReservations.push({
            key: existing.objectKey,
            uploadedAt: existing.createdAt,
            sizeBytes: existing.sizeBytes,
            kind: 'object',
            reservationId: existing.id,
          });
          existingReservationKeys.add(existing.objectKey);
        }
      }
      const temporaryCandidates: Candidate[] = temporaryScan.entries.map((entry) => ({
        ...entry,
        kind: 'temporary' as const,
        reservationId: null,
      }));
      const selected = [...existingReservations, ...newObjects, ...temporaryCandidates]
        .sort((left, right) => {
          const byUploadedAt = left.uploadedAt.getTime() - right.uploadedAt.getTime();
          return byUploadedAt === 0 ? left.key.localeCompare(right.key) : byUploadedAt;
        })
        .slice(0, input.limit);

      for (const candidate of selected) {
        if (candidate.kind !== 'object' || candidate.reservationId !== null) {
          continue;
        }
        const sha256 = sha256FromObjectKey(input.accountId, candidate.key);
        const reservationId = dependencies.idFactory.next<'Blob'>() as BlobId;
        await tx.blobs.insert({
          id: reservationId,
          accountId: input.accountId,
          sha256,
          sizeBytes: candidate.sizeBytes,
          contentType: ORPHAN_RESERVATION_CONTENT_TYPE,
          objectKey: candidate.key,
          status: 'deleting',
          createdAt: candidate.uploadedAt,
          readyAt: now,
          deletedAt: now,
        });
        candidate.reservationId = reservationId;
      }
      const selectedObjectKeys = new Set(
        selected
          .filter((candidate) => candidate.kind === 'object')
          .map((candidate) => candidate.key),
      );
      return {
        candidates: selected,
        objectScanFullyConsumed: [...eligibleObjectKeys].every((key) =>
          selectedObjectKeys.has(key),
        ),
        temporaryScanFullyConsumed: temporaryCandidates.every((candidate) =>
          selected.includes(candidate),
        ),
      };
    });

    let deletedObjectCount = 0;
    let deletedTemporaryCount = 0;
    for (const candidate of claimed.candidates) {
      if (candidate.kind === 'temporary') {
        await dependencies.blobStore.deleteTemporary({
          accountId: input.accountId,
          temporaryKey: candidate.key,
        });
        deletedTemporaryCount += 1;
        continue;
      }
      if (candidate.reservationId === null) {
        throw new MailCoreError('BLOB_INTEGRITY');
      }
      const reservationId = candidate.reservationId;
      await dependencies.blobStore.delete({
        accountId: input.accountId,
        objectKey: candidate.key,
      });
      const finalized = await dependencies.unitOfWork.run(async (tx) => {
        await tx.lockAccount(input.accountId);
        const reservation = await tx.blobs.findById(input.accountId, reservationId);
        if (reservation === null) {
          return false;
        }
        if (
          reservation.status !== 'deleting' ||
          reservation.readyAt === null ||
          reservation.deletedAt === null ||
          reservation.contentType !== ORPHAN_RESERVATION_CONTENT_TYPE ||
          reservation.objectKey !== candidate.key
        ) {
          throw new MailCoreError('BLOB_INTEGRITY');
        }
        await tx.blobs.delete(input.accountId, reservation.id);
        return true;
      });
      if (finalized) {
        deletedObjectCount += 1;
      }
    }
    const deletedAnObject = claimed.candidates.some((candidate) => candidate.kind === 'object');
    const deletedTemporary = claimed.candidates.some((candidate) => candidate.kind === 'temporary');
    const cursor = {
      object: deletedAnObject
        ? { value: null, exhausted: false }
        : claimed.objectScanFullyConsumed
          ? { value: objectScan.cursor, exhausted: objectScan.exhausted }
          : initialCursor.object,
      temporary: deletedTemporary
        ? { value: null, exhausted: false }
        : claimed.temporaryScanFullyConsumed
          ? { value: temporaryScan.cursor, exhausted: temporaryScan.exhausted }
          : initialCursor.temporary,
    };
    return { deletedObjectCount, deletedTemporaryCount, cursor };
  } catch (error) {
    if (error instanceof MailCoreError && error.code !== 'BLOB_STORE_FAILURE') {
      throw error;
    }
    throw new MailCoreError('BLOB_STORE_FAILURE');
  }
}
