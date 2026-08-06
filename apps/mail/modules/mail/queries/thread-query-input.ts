import type { MailboxRoute } from '../routing/mailbox-route';

export type ThreadCategoryFilter = {
  hasMailboxIds?: string[];
  hasKeywords?: string[];
  unreadOnly?: true;
};

const legacyCategoryKeywords: Readonly<Record<string, string>> = {
  IMPORTANT: '$important',
  STARRED: '$flagged',
  CUSTOMER: 'customer',
};

export function buildThreadCategoryFilter(searchValue: string): ThreadCategoryFilter {
  const hasMailboxIds = new Set<string>();
  const hasKeywords = new Set<string>();
  let unreadOnly = false;

  for (const value of searchValue.split(',')) {
    const token = value.trim();
    if (!token) continue;

    const normalizedToken = token.toUpperCase();
    if (normalizedToken === 'UNREAD') {
      unreadOnly = true;
      continue;
    }

    const legacyKeyword = legacyCategoryKeywords[normalizedToken];
    if (legacyKeyword) {
      hasKeywords.add(legacyKeyword);
      continue;
    }

    if (token.startsWith('$')) {
      hasKeywords.add(token.toLowerCase());
      continue;
    }

    hasMailboxIds.add(token);
  }

  return {
    ...(hasMailboxIds.size > 0 ? { hasMailboxIds: [...hasMailboxIds] } : {}),
    ...(hasKeywords.size > 0 ? { hasKeywords: [...hasKeywords] } : {}),
    ...(unreadOnly ? { unreadOnly: true as const } : {}),
  };
}

export function buildThreadPageInput({
  accountId,
  route,
  text,
  categorySearchValue = '',
  cursor,
  limit = 50,
}: {
  accountId: string;
  route: MailboxRoute;
  text: string;
  categorySearchValue?: string;
  cursor?: string;
  limit?: number;
}) {
  if (route.kind === 'not-found') {
    throw new Error('MAILBOX_ROUTE_NOT_FOUND');
  }

  const normalizedText = text.trim();
  const categoryFilter = buildThreadCategoryFilter(categorySearchValue);
  return {
    accountId,
    ...(route.kind === 'mailbox' ? { mailboxId: route.mailboxId } : { snoozed: true }),
    ...(normalizedText ? { text: normalizedText } : {}),
    ...categoryFilter,
    ...(cursor ? { cursor } : {}),
    limit,
  };
}

export function buildThreadDetailInput(accountId: string, threadId: string) {
  return {
    accountId,
    threadId,
    fetchTextBodyValues: true,
    fetchHTMLBodyValues: true,
    maxBodyValueBytes: 256_000,
  };
}
