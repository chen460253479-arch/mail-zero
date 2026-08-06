import { describe, expect, it } from 'vitest';

import { sortMessagesNewestFirst } from './message-order';

describe('sortMessagesNewestFirst', () => {
  it('places the newest message at the top without mutating the source array', () => {
    const messages = [
      { id: 'older', receivedOn: '2026-08-06T16:02:00.000Z' },
      { id: 'newer', receivedOn: '2026-08-06T16:22:00.000Z' },
    ];

    expect(sortMessagesNewestFirst(messages).map(({ id }) => id)).toEqual(['newer', 'older']);
    expect(messages.map(({ id }) => id)).toEqual(['older', 'newer']);
  });

  it('keeps the source order stable when timestamps are equal or invalid', () => {
    const messages = [
      { id: 'first', receivedOn: 'not-a-date' },
      { id: 'second', receivedOn: 'not-a-date' },
      { id: 'third', receivedOn: '2026-08-06T16:22:00.000Z' },
    ];

    expect(sortMessagesNewestFirst(messages).map(({ id }) => id)).toEqual([
      'third',
      'first',
      'second',
    ]);
  });
});
