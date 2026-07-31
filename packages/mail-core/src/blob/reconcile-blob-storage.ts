import type { BlobKind, BlobStoreEntry, BlobStoreListKind, MailCoreDependencies } from '../store';
import { MailCoreError, type BlobId, type MailAccountId } from '../types';
import { contentAddressedObjectKey } from './blob-lifecycle';

const MAX_MAINTENANCE_BATCH = 1000;
const LIST_PAGE_SIZE = 1000;
const MAX_SCAN_PAGES_PER_KIND = 10;
const ORPHAN_RESERVATION_CONTENT_TYPE = 'application/x-zero-orphan-reservation';
const PERSISTENT_KINDS = [
  'attachment',
  'draft_mime',
  'message_mime',
] as const satisfies readonly BlobKind[];

type ScanCursor = {
  value: string | null;
  exhausted: boolean;
};

export type ReconcileBlobStorageCursor = Record<BlobStoreListKind, ScanCursor>;

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
  kind: BlobStoreListKind;
  reservationId: BlobId | null;
};

const initialCursor = (): ReconcileBlobStorageCursor => ({
  attachment: { value: null, exhausted: false },
  draft_mime: { value: null, exhausted: false },
  message_mime: { value: null, exhausted: false },
  temporary: { value: null, exhausted: false },
});

const objectIdentity = (
  userId: string,
  accountId: MailAccountId,
  objectKey: string,
): { kind: BlobKind; sha256: string } => {
  const sha256 = objectKey.split('/').at(-1);
  if (sha256 === undefined || !/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new MailCoreError('BLOB_INTEGRITY');
  }
  const kind = PERSISTENT_KINDS.find(
    (candidate) => contentAddressedObjectKey(userId, accountId, candidate, sha256) === objectKey,
  );
  if (kind === undefined) {
    throw new MailCoreError('BLOB_INTEGRITY');
  }
  return { kind, sha256 };
};

const scanCandidates = async (
  dependencies: MailCoreDependencies,
  userId: string,
  accountId: MailAccountId,
  kind: BlobStoreListKind,
  olderThan: Date,
  limit: number,
  cursorState: ScanCursor,
): Promise<{ entries: BlobStoreEntry[]; cursor: string | null; exhausted: boolean }> => {
  if (limit === 0 || cursorState.exhausted) {
    return {
      entries: [],
      cursor: cursorState.value,
      exhausted: cursorState.exhausted,
    };
  }

  const entries: BlobStoreEntry[] = [];
  const seenCursors = new Set<string>(cursorState.value === null ? [] : [cursorState.value]);
  let cursor = cursorState.value;
  for (let pageNumber = 0; pageNumber < MAX_SCAN_PAGES_PER_KIND; pageNumber += 1) {
    const pageLimit = Math.min(LIST_PAGE_SIZE, limit - entries.length);
    let page;
    try {
      page = await dependencies.blobStore.list({
        userId,
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
    const account = await dependencies.unitOfWork.run((tx) =>
      tx.accounts.findById(input.accountId),
    );
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const cursorBefore = input.cursor ?? initialCursor();
    const pendingReservations = await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      return tx.blobs.listDeletingByContentType(
        input.accountId,
        ORPHAN_RESERVATION_CONTENT_TYPE,
        input.limit,
      );
    });
    const scanLimit = Math.max(0, input.limit - pendingReservations.length);
    const scans = new Map<
      BlobStoreListKind,
      { entries: BlobStoreEntry[]; cursor: string | null; exhausted: boolean }
    >();
    for (const kind of [...PERSISTENT_KINDS, 'temporary'] as const) {
      scans.set(
        kind,
        await scanCandidates(
          dependencies,
          account.userId,
          input.accountId,
          kind,
          input.olderThan,
          scanLimit,
          cursorBefore[kind],
        ),
      );
    }

    const claimed = await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const currentAccount = await tx.accounts.findById(input.accountId);
      if (currentAccount === null) {
        throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
      }
      if (currentAccount.userId !== account.userId) {
        throw new MailCoreError('BLOB_INTEGRITY', { entityId: input.accountId });
      }
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
        const identity = objectIdentity(account.userId, input.accountId, blob.objectKey);
        if (blob.sha256 !== identity.sha256 || blob.kind !== identity.kind) {
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
          kind: blob.kind,
          reservationId: blob.id,
        });
      }

      const existingReservationKeys = new Set(
        existingReservations.map((reservation) => reservation.key),
      );
      const eligibleKeys = new Map<BlobKind, Set<string>>(
        PERSISTENT_KINDS.map((kind) => [kind, new Set<string>()]),
      );
      const newObjects: Candidate[] = [];
      for (const scanKind of PERSISTENT_KINDS) {
        for (const entry of scans.get(scanKind)!.entries) {
          const identity = objectIdentity(account.userId, input.accountId, entry.key);
          if (identity.kind !== scanKind) {
            throw new MailCoreError('BLOB_INTEGRITY');
          }
          const owner = await tx.blobs.findByObjectKeyExcluding(input.accountId, entry.key, {
            status: 'deleting',
            contentType: ORPHAN_RESERVATION_CONTENT_TYPE,
          });
          if (owner !== null) continue;
          const existing = await tx.blobs.findByDigest(
            input.accountId,
            scanKind,
            identity.sha256,
            entry.sizeBytes,
          );
          if (existing === null) {
            eligibleKeys.get(scanKind)!.add(entry.key);
            newObjects.push({ ...entry, kind: scanKind, reservationId: null });
            continue;
          }
          if (
            existing.status === 'deleting' &&
            existing.contentType === ORPHAN_RESERVATION_CONTENT_TYPE
          ) {
            eligibleKeys.get(scanKind)!.add(entry.key);
            if (existingReservationKeys.has(existing.objectKey)) continue;
            if (existing.readyAt === null || existing.deletedAt === null) {
              throw new MailCoreError('BLOB_INTEGRITY');
            }
            existingReservations.push({
              key: existing.objectKey,
              uploadedAt: existing.createdAt,
              sizeBytes: existing.sizeBytes,
              kind: existing.kind,
              reservationId: existing.id,
            });
            existingReservationKeys.add(existing.objectKey);
          }
        }
      }
      const temporaryCandidates: Candidate[] = scans
        .get('temporary')!
        .entries.map((entry) => ({ ...entry, kind: 'temporary', reservationId: null }));
      const selected = [...existingReservations, ...newObjects, ...temporaryCandidates]
        .sort((left, right) => {
          const byUploadedAt = left.uploadedAt.getTime() - right.uploadedAt.getTime();
          return byUploadedAt === 0 ? left.key.localeCompare(right.key) : byUploadedAt;
        })
        .slice(0, input.limit);

      for (const candidate of selected) {
        if (candidate.kind === 'temporary' || candidate.reservationId !== null) continue;
        const identity = objectIdentity(account.userId, input.accountId, candidate.key);
        const reservationId = dependencies.idFactory.next<'Blob'>() as BlobId;
        await tx.blobs.insert({
          id: reservationId,
          accountId: input.accountId,
          kind: identity.kind,
          sha256: identity.sha256,
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
      const selectedKeys = new Set(selected.map((candidate) => candidate.key));
      return {
        candidates: selected,
        fullyConsumed: Object.fromEntries(
          PERSISTENT_KINDS.map((kind) => [
            kind,
            [...eligibleKeys.get(kind)!].every((key) => selectedKeys.has(key)),
          ]),
        ) as Record<BlobKind, boolean>,
        temporaryFullyConsumed: temporaryCandidates.every((candidate) =>
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
        if (reservation === null) return false;
        if (
          reservation.status !== 'deleting' ||
          reservation.readyAt === null ||
          reservation.deletedAt === null ||
          reservation.contentType !== ORPHAN_RESERVATION_CONTENT_TYPE ||
          reservation.objectKey !== candidate.key ||
          reservation.kind !== candidate.kind
        ) {
          throw new MailCoreError('BLOB_INTEGRITY');
        }
        await tx.blobs.delete(input.accountId, reservation.id);
        return true;
      });
      if (finalized) deletedObjectCount += 1;
    }

    const nextCursor = initialCursor();
    for (const kind of PERSISTENT_KINDS) {
      const deleted = claimed.candidates.some((candidate) => candidate.kind === kind);
      const scan = scans.get(kind)!;
      nextCursor[kind] = deleted
        ? { value: null, exhausted: false }
        : claimed.fullyConsumed[kind]
          ? { value: scan.cursor, exhausted: scan.exhausted }
          : cursorBefore[kind];
    }
    const deletedTemporary = claimed.candidates.some((candidate) => candidate.kind === 'temporary');
    const temporaryScan = scans.get('temporary')!;
    nextCursor.temporary = deletedTemporary
      ? { value: null, exhausted: false }
      : claimed.temporaryFullyConsumed
        ? { value: temporaryScan.cursor, exhausted: temporaryScan.exhausted }
        : cursorBefore.temporary;

    return { deletedObjectCount, deletedTemporaryCount, cursor: nextCursor };
  } catch (error) {
    if (error instanceof MailCoreError && error.code !== 'BLOB_STORE_FAILURE') {
      throw error;
    }
    throw new MailCoreError('BLOB_STORE_FAILURE');
  }
}
