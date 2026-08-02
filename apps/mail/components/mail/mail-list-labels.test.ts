import { describe, expect, it } from 'vitest';

import { buildOptimisticMailListLabels } from './mail-list-labels';
import type { Label } from '../../types';

const sourceLabels = (): Label[] => [
  { id: 'customer', name: 'Customer', type: 'label' },
  { id: '$important', name: 'IMPORTANT', type: 'keyword' },
];

describe('buildOptimisticMailListLabels', () => {
  it('applies important and starred state immediately without mutating API labels', () => {
    const source = sourceLabels();

    const result = buildOptimisticMailListLabels(source, {
      important: false,
      starred: true,
      labelChanges: { addedLabelIds: [], removedLabelIds: [] },
    });

    expect(result).toEqual([
      { id: 'customer', name: 'Customer', type: 'label' },
      { id: '$flagged', name: 'STARRED', type: 'keyword' },
    ]);
    expect(source).toEqual(sourceLabels());
  });

  it('preserves the existing optimistic custom-label behavior', () => {
    const result = buildOptimisticMailListLabels(sourceLabels(), {
      important: null,
      starred: null,
      labelChanges: { addedLabelIds: ['prospect'], removedLabelIds: ['customer'] },
    });

    expect(result).toEqual([
      { id: '$important', name: 'IMPORTANT', type: 'keyword' },
      { id: 'prospect', name: 'prospect', type: 'label' },
    ]);
  });
});
