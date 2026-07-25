import { describe, expect, it } from 'vitest';

import { calculateThreadDecision, type ThreadId } from '../../src';

describe('calculateThreadDecision', () => {
  it('uses an existing Thread only when reference and subject match', () => {
    expect(
      calculateThreadDecision({
        normalizedSubject: 'release',
        referenceIds: ['root@example.com'],
        candidates: [
          {
            threadId: 'thread-1' as ThreadId,
            normalizedSubject: 'release',
            matchedReference: 'root@example.com',
          },
        ],
      }),
    ).toEqual({ type: 'use', threadId: 'thread-1' });

    expect(
      calculateThreadDecision({
        normalizedSubject: 'different',
        referenceIds: ['root@example.com'],
        candidates: [
          {
            threadId: 'thread-1' as ThreadId,
            normalizedSubject: 'release',
            matchedReference: 'root@example.com',
          },
        ],
      }),
    ).toEqual({ type: 'create' });

    expect(
      calculateThreadDecision({
        normalizedSubject: 'release',
        referenceIds: ['other@example.com'],
        candidates: [
          {
            threadId: 'thread-1' as ThreadId,
            normalizedSubject: 'release',
            matchedReference: 'root@example.com',
          },
        ],
      }),
    ).toEqual({ type: 'create' });
  });

  it('merges bridged Threads with the smallest ID as winner', () => {
    expect(
      calculateThreadDecision({
        normalizedSubject: 'release',
        referenceIds: ['a@example.com', 'b@example.com', 'c@example.com'],
        candidates: [
          {
            threadId: 'thread-c' as ThreadId,
            normalizedSubject: 'release',
            matchedReference: 'c@example.com',
          },
          {
            threadId: 'thread-b' as ThreadId,
            normalizedSubject: 'release',
            matchedReference: 'b@example.com',
          },
          {
            threadId: 'thread-a' as ThreadId,
            normalizedSubject: 'release',
            matchedReference: 'a@example.com',
          },
        ],
      }),
    ).toEqual({
      type: 'merge',
      winnerThreadId: 'thread-a',
      loserThreadIds: ['thread-b', 'thread-c'],
    });
  });
});
