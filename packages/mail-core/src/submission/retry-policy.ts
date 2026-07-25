const retryDelaysMs = [30_000, 120_000, 600_000, 1_800_000, 7_200_000] as const;

export function calculateRetryAt(now: Date, attemptNumber: number): Date | null {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 6) {
    throw new RangeError('INVALID_ATTEMPT_NUMBER');
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('INVALID_RETRY_TIME');
  }
  if (attemptNumber === 6) {
    return null;
  }
  return new Date(nowMs + retryDelaysMs[attemptNumber - 1]!);
}
