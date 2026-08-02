import type { Label } from '../../types';

type OptimisticKeywordState = {
  important: boolean | null;
  starred: boolean | null;
};

type KeywordTag = {
  id: '$important' | '$flagged';
  name: 'IMPORTANT' | 'STARRED';
};

const keywordTags = {
  important: { id: '$important', name: 'IMPORTANT' },
  starred: { id: '$flagged', name: 'STARRED' },
} as const satisfies Record<keyof OptimisticKeywordState, KeywordTag>;

const matchesKeyword = (label: Label, keyword: KeywordTag) =>
  label.type === 'keyword' && (label.id === keyword.id || label.name === keyword.name);

const applyKeywordState = (
  labels: Label[],
  keyword: KeywordTag,
  enabled: boolean | null,
): Label[] => {
  if (enabled === null) return labels;
  const withoutKeyword = labels.filter((label) => !matchesKeyword(label, keyword));
  return enabled
    ? [...withoutKeyword, { id: keyword.id, name: keyword.name, type: 'keyword' }]
    : withoutKeyword;
};

export function applyOptimisticKeywordTags(
  tags: readonly Label[],
  state: OptimisticKeywordState,
): Label[] {
  const withImportant = applyKeywordState([...tags], keywordTags.important, state.important);
  return applyKeywordState(withImportant, keywordTags.starred, state.starred);
}
