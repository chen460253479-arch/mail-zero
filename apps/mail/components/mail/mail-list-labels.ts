import { applyOptimisticKeywordTags } from './optimistic-keyword-tags';
import type { Label } from '../../types';

type OptimisticListLabelState = {
  important: boolean | null;
  starred: boolean | null;
  labelChanges: {
    addedLabelIds: string[];
    removedLabelIds: string[];
  };
};

export function buildOptimisticMailListLabels(
  labels: readonly Label[],
  state: OptimisticListLabelState,
): Label[] {
  let nextLabels = applyOptimisticKeywordTags(labels, {
    important: state.important,
    starred: state.starred,
  });

  nextLabels = nextLabels.filter((label) => !state.labelChanges.removedLabelIds.includes(label.id));

  for (const labelId of state.labelChanges.addedLabelIds) {
    if (!nextLabels.some((label) => label.id === labelId)) {
      nextLabels.push({ id: labelId, name: labelId, type: 'label' });
    }
  }

  return nextLabels;
}
