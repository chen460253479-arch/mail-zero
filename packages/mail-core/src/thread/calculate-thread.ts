import type { ThreadId } from '../types';

export type ThreadCandidate = {
  threadId: ThreadId;
  normalizedSubject: string;
  matchedReference: string;
};

export type ThreadDecision =
  | { type: 'create' }
  | { type: 'use'; threadId: ThreadId }
  | { type: 'merge'; winnerThreadId: ThreadId; loserThreadIds: ThreadId[] };

export type CalculateThreadDecisionInput = {
  normalizedSubject: string;
  referenceIds: string[];
  candidates: ThreadCandidate[];
};

export function calculateThreadDecision(input: CalculateThreadDecisionInput): ThreadDecision {
  const referenceIds = new Set(input.referenceIds);
  const matchingThreadIds = Array.from(
    new Set(
      input.candidates
        .filter(
          (candidate) =>
            candidate.normalizedSubject === input.normalizedSubject &&
            referenceIds.has(candidate.matchedReference),
        )
        .map((candidate) => candidate.threadId),
    ),
  ).sort();

  if (matchingThreadIds.length === 0) {
    return { type: 'create' };
  }

  if (matchingThreadIds.length === 1) {
    return { type: 'use', threadId: matchingThreadIds[0]! };
  }

  return {
    type: 'merge',
    winnerThreadId: matchingThreadIds[0]!,
    loserThreadIds: matchingThreadIds.slice(1),
  };
}
