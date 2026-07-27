import type { Mailbox, MailboxRole } from '../model/mailbox';

type CommonThreadAction = {
  accountId: string;
  threadIds: string[];
  ifInState?: string;
  clientMutationId: string;
};

export function buildKeywordThreadAction({
  keyword,
  enabled,
  ...common
}: CommonThreadAction & {
  keyword: string;
  enabled: boolean;
}) {
  return {
    accountId: common.accountId,
    threadIds: common.threadIds,
    ...(common.ifInState ? { ifInState: common.ifInState } : {}),
    addMailboxIds: [],
    removeMailboxIds: [],
    addKeywords: enabled ? [keyword] : [],
    removeKeywords: enabled ? [] : [keyword],
    clientMutationId: common.clientMutationId,
  };
}

const destinationRoles = {
  inbox: 'inbox',
  archive: 'archive',
  spam: 'junk',
  bin: 'trash',
} as const satisfies Record<string, MailboxRole>;

const exclusiveSystemRoles: MailboxRole[] = ['inbox', 'archive', 'junk', 'trash'];

export function buildMoveThreadAction({
  destination,
  mailboxes,
  ...common
}: CommonThreadAction & {
  destination: keyof typeof destinationRoles;
  mailboxes: readonly Mailbox[];
}) {
  const destinationRole = destinationRoles[destination];
  const destinationMailbox = mailboxes.find((mailbox) => mailbox.role === destinationRole);
  if (!destinationMailbox) {
    throw new Error(`MAILBOX_ROLE_NOT_FOUND:${destinationRole}`);
  }

  const removeMailboxIds = mailboxes
    .filter(
      (mailbox) =>
        mailbox.role !== null &&
        exclusiveSystemRoles.includes(mailbox.role) &&
        mailbox.id !== destinationMailbox.id,
    )
    .map((mailbox) => mailbox.id);

  return {
    accountId: common.accountId,
    threadIds: common.threadIds,
    ...(common.ifInState ? { ifInState: common.ifInState } : {}),
    addMailboxIds: [destinationMailbox.id],
    removeMailboxIds,
    addKeywords: [],
    removeKeywords: [],
    clientMutationId: common.clientMutationId,
  };
}
