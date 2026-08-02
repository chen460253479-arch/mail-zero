import { describe, expect, it } from 'vitest';

import { applyOptimisticKeywordTags } from './optimistic-keyword-tags';
import type { Label } from '../../types';

const originalTags = (): Label[] => [
  { id: 'label-customer', name: 'Customer', type: 'label' },
  { id: '$important', name: 'IMPORTANT', type: 'keyword' },
  { id: '$flagged', name: 'STARRED', type: 'keyword' },
];

describe('applyOptimisticKeywordTags', () => {
  it('removes important and starred tags without mutating the source', () => {
    const source = originalTags();

    const result = applyOptimisticKeywordTags(source, {
      important: false,
      starred: false,
    });

    expect(result).toEqual([{ id: 'label-customer', name: 'Customer', type: 'label' }]);
    expect(source).toEqual(originalTags());
  });

  it('adds important and starred tags once while preserving unrelated labels', () => {
    const result = applyOptimisticKeywordTags(
      [
        { id: 'label-customer', name: 'Customer', type: 'label' },
        { id: '$important', name: 'IMPORTANT', type: 'keyword' },
      ],
      { important: true, starred: true },
    );

    expect(result).toEqual([
      { id: 'label-customer', name: 'Customer', type: 'label' },
      { id: '$important', name: 'IMPORTANT', type: 'keyword' },
      { id: '$flagged', name: 'STARRED', type: 'keyword' },
    ]);
  });

  it('preserves API tags when no optimistic state exists', () => {
    const source = originalTags();

    const result = applyOptimisticKeywordTags(source, {
      important: null,
      starred: null,
    });

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
  });
});
