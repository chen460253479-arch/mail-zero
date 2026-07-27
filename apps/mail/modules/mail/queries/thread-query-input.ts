import type { MailboxRoute } from '../routing/mailbox-route';

export function buildThreadPageInput({
  accountId,
  route,
  text,
  cursor,
  limit = 50,
}: {
  accountId: string;
  route: MailboxRoute;
  text: string;
  cursor?: string;
  limit?: number;
}) {
  if (route.kind === 'not-found') {
    throw new Error('MAILBOX_ROUTE_NOT_FOUND');
  }

  const normalizedText = text.trim();
  return {
    accountId,
    ...(route.kind === 'mailbox' ? { mailboxId: route.mailboxId } : { snoozed: true }),
    ...(normalizedText ? { text: normalizedText } : {}),
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
