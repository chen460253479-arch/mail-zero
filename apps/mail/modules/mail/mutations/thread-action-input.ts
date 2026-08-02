import type { Mailbox, MailboxRole } from '../model/mailbox';

type CommonThreadAction = {
  accountId: string;
  threadIds: string[];
  clientMutationId: string;
};

type StateConditionalThreadAction = CommonThreadAction & {
  ifInState?: string;
};

export type SystemMoveDestination = 'inbox' | 'archive' | 'spam' | 'bin';

const systemDestinationRoles = {
  inbox: 'inbox',
  archive: 'archive',
  spam: 'junk',
  bin: 'trash',
} as const satisfies Record<SystemMoveDestination, MailboxRole>;

export function resolveSystemMoveDestinationMailboxId(
  destination: SystemMoveDestination,
  mailboxes: readonly Mailbox[],
): string {
  const role = systemDestinationRoles[destination];
  const mailbox = mailboxes.find(
    (candidate) => candidate.kind === 'system' && candidate.role === role,
  );
  if (!mailbox) throw new Error(`MAILBOX_ROLE_NOT_FOUND:${role}`);
  return mailbox.id;
}

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
    addMailboxIds: [],
    removeMailboxIds: [],
    addKeywords: enabled ? [keyword] : [],
    removeKeywords: enabled ? [] : [keyword],
    clientMutationId: common.clientMutationId,
  };
}

export function buildMoveThreadAction({
  sourceMailboxId,
  destinationMailboxId,
  ...common
}: StateConditionalThreadAction & {
  sourceMailboxId: string;
  destinationMailboxId: string;
}) {
  return {
    accountId: common.accountId,
    threadIds: common.threadIds,
    ...(common.ifInState ? { ifInState: common.ifInState } : {}),
    sourceMailboxId,
    destinationMailboxId,
    clientMutationId: common.clientMutationId,
  };
}

export function buildRestoreArchivedThreadAction(common: StateConditionalThreadAction) {
  return {
    accountId: common.accountId,
    threadIds: common.threadIds,
    ...(common.ifInState ? { ifInState: common.ifInState } : {}),
    clientMutationId: common.clientMutationId,
  };
}

export function buildSetThreadLabelsAction({
  addLabelIds,
  removeLabelIds,
  mailboxes,
  ...common
}: StateConditionalThreadAction & {
  addLabelIds: readonly string[];
  removeLabelIds: readonly string[];
  mailboxes: readonly Mailbox[];
}) {
  const mailboxById = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  const requireLabels = (mailboxIds: readonly string[]) =>
    [...new Set(mailboxIds)].map((mailboxId) => {
      if (mailboxById.get(mailboxId)?.kind !== 'label') {
        throw new Error(`MAILBOX_LABEL_NOT_FOUND:${mailboxId}`);
      }
      return mailboxId;
    });
  const addMailboxIds = requireLabels(addLabelIds);
  const removeMailboxIds = requireLabels(removeLabelIds).filter(
    (mailboxId) => !addMailboxIds.includes(mailboxId),
  );

  return {
    accountId: common.accountId,
    threadIds: common.threadIds,
    ...(common.ifInState ? { ifInState: common.ifInState } : {}),
    addMailboxIds,
    removeMailboxIds,
    addKeywords: [],
    removeKeywords: [],
    clientMutationId: common.clientMutationId,
  };
}
