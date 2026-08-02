type UpdateKeyword = (threadIds: string[], keyword: string, enabled: boolean) => Promise<void>;

export function createKeywordActionOperations({
  accountId,
  threadIds,
  keyword,
  enabled,
  updateKeyword,
}: {
  accountId: string;
  threadIds: string[];
  keyword: string;
  enabled: boolean;
  updateKeyword: UpdateKeyword;
}) {
  return {
    queueKey: `${accountId}:${keyword}`,
    execute: () => updateKeyword(threadIds, keyword, enabled),
    revert: () => updateKeyword(threadIds, keyword, !enabled),
  };
}
