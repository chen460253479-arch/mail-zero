import type { MailboxKind, MailboxRole } from '../model/mailbox';

export type RoutableMailbox = {
  id: string;
  kind: MailboxKind;
  role: MailboxRole | null;
};

export type MailboxRoute =
  | { kind: 'mailbox'; mailboxId: string }
  | { kind: 'snoozed' }
  | { kind: 'not-found' };

const STANDARD_ROUTE_ROLES: Readonly<Record<string, MailboxRole>> = {
  inbox: 'inbox',
  draft: 'drafts',
  sent: 'sent',
  spam: 'junk',
  bin: 'trash',
  archive: 'archive',
};

export function resolveMailboxRoute(
  slug: string,
  mailboxes: readonly RoutableMailbox[],
): MailboxRoute {
  if (slug === 'snoozed') {
    return { kind: 'snoozed' };
  }

  const role = STANDARD_ROUTE_ROLES[slug];
  if (role) {
    const systemMailbox = mailboxes.find((mailbox) => mailbox.role === role);
    return systemMailbox ? { kind: 'mailbox', mailboxId: systemMailbox.id } : { kind: 'not-found' };
  }

  const mailbox = mailboxes.find(
    (candidate) =>
      candidate.id === slug && (candidate.kind === 'folder' || candidate.kind === 'label'),
  );

  return mailbox ? { kind: 'mailbox', mailboxId: mailbox.id } : { kind: 'not-found' };
}

export function resolveActiveMailboxId(
  pathname: string,
  mailboxes: readonly RoutableMailbox[],
): string | null {
  const prefix = '/mail/';
  if (!pathname.startsWith(prefix)) return null;
  try {
    const slug = decodeURIComponent(pathname.slice(prefix.length).split('/')[0] ?? '');
    const route = resolveMailboxRoute(slug, mailboxes);
    return route.kind === 'mailbox' ? route.mailboxId : null;
  } catch {
    return null;
  }
}
