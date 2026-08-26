export type ThreadPageFilter = {
  mailboxId?: string;
  text?: string;
  hasKeyword?: string;
  hasKeywords?: string[];
  hasMailboxIds?: string[];
  unreadOnly?: boolean;
  lifecycle?: string;
  snoozed?: boolean;
  limit?: number;
};

const normalizeThreadPageFilter = (filter: ThreadPageFilter = {}) => ({
  ...(filter.mailboxId ? { mailboxId: filter.mailboxId } : {}),
  ...(filter.text?.trim() ? { text: filter.text.trim() } : {}),
  ...(filter.hasKeyword ? { hasKeyword: filter.hasKeyword } : {}),
  ...(filter.hasKeywords?.length ? { hasKeywords: [...new Set(filter.hasKeywords)].sort() } : {}),
  ...(filter.hasMailboxIds?.length
    ? { hasMailboxIds: [...new Set(filter.hasMailboxIds)].sort() }
    : {}),
  ...(filter.unreadOnly ? { unreadOnly: true as const } : {}),
  ...(filter.lifecycle ? { lifecycle: filter.lifecycle } : {}),
  ...(filter.snoozed ? { snoozed: true as const } : {}),
  ...(filter.limit === undefined ? {} : { limit: filter.limit }),
});

export const mailQueryKeys = {
  all: (accountId: string) => ['mail', accountId] as const,
  account: (accountId: string) => ['mail', accountId, 'account'] as const,
  mailboxes: (accountId: string) => ['mail', accountId, 'mailboxes'] as const,
  threadPages: (accountId: string) => ['mail', accountId, 'thread-pages'] as const,
  threadPage: (accountId: string, filter: ThreadPageFilter = {}) =>
    ['mail', accountId, 'thread-pages', normalizeThreadPageFilter(filter)] as const,
  thread: (accountId: string, threadId: string) =>
    ['mail', accountId, 'threads', threadId] as const,
  email: (accountId: string, emailId: string) => ['mail', accountId, 'emails', emailId] as const,
  identities: (accountId: string) => ['mail', accountId, 'identities'] as const,
  submissions: (accountId: string) => ['mail', accountId, 'submissions'] as const,
  submission: (accountId: string, submissionId: string) =>
    ['mail', accountId, 'submissions', submissionId] as const,
  changes: (accountId: string, collection: string) =>
    ['mail', accountId, 'changes', collection] as const,
};
