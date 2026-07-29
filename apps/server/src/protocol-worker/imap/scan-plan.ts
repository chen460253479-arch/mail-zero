import type { ImapPageCursor } from '../contracts';

const RECOVERY_OVERLAP_MS = 5 * 60_000;

export const createImapScanPlan = (input: {
  actualUidValidity: string;
  actualUidNext: number;
  expectedUidValidity: string;
  nextUid: number;
  lastSuccessfulAt: string;
  cursor: ImapPageCursor | null;
}): ImapPageCursor => {
  const upperUid = Math.max(0, input.actualUidNext - 1);
  if (
    input.cursor !== null &&
    input.cursor.uidValidity === input.actualUidValidity &&
    input.cursor.upperUid <= upperUid
  ) {
    return input.cursor;
  }
  if (input.actualUidValidity === input.expectedUidValidity) {
    return {
      mode: 'uid',
      uidValidity: input.actualUidValidity,
      nextUid: input.nextUid,
      upperUid,
    };
  }
  const lastSuccessfulAt = new Date(input.lastSuccessfulAt);
  return {
    mode: 'recovery',
    uidValidity: input.actualUidValidity,
    nextUid: 1,
    upperUid,
    receivedSince: new Date(lastSuccessfulAt.getTime() - RECOVERY_OVERLAP_MS).toISOString(),
  };
};

export const nextImapPageCursor = (
  plan: ImapPageCursor,
  returnedUids: readonly number[],
  limit: number,
): ImapPageCursor | null => {
  if (returnedUids.length < limit || returnedUids.length === 0) return null;
  const lastUid = Math.max(...returnedUids);
  if (lastUid >= plan.upperUid) return null;
  return {
    ...plan,
    nextUid: lastUid + 1,
  };
};
