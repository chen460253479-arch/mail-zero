import type { CustomMailboxKind } from '../model/mailbox';

type MailboxSetContext = {
  accountId: string;
  state?: string;
};

const base = ({ accountId, state }: MailboxSetContext) => ({
  accountId,
  ...(state ? { ifInState: state } : {}),
  create: {},
  update: {},
  destroy: [] as string[],
});

export function buildCreateMailboxInput({
  clientId,
  name,
  kind,
  parentId,
  ...context
}: MailboxSetContext & {
  clientId: string;
  name: string;
  kind: CustomMailboxKind;
  parentId: string | null;
}) {
  return {
    ...base(context),
    create: {
      [clientId]: {
        name,
        kind,
        role: null,
        parentId,
      },
    },
  };
}

export function buildUpdateMailboxInput({
  mailboxId,
  name,
  color,
  parentId,
  sortOrder,
  isSubscribed,
  ...context
}: MailboxSetContext & {
  mailboxId: string;
  name?: string;
  color?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  isSubscribed?: boolean;
}) {
  return {
    ...base(context),
    update: {
      [mailboxId]: {
        ...(name === undefined ? {} : { name }),
        ...(color === undefined ? {} : { color }),
        ...(parentId === undefined ? {} : { parentId }),
        ...(sortOrder === undefined ? {} : { sortOrder }),
        ...(isSubscribed === undefined ? {} : { isSubscribed }),
      },
    },
  };
}

export function buildDestroyMailboxInput({
  mailboxId,
  ...context
}: MailboxSetContext & {
  mailboxId: string;
}) {
  return {
    ...base(context),
    destroy: [mailboxId],
  };
}
