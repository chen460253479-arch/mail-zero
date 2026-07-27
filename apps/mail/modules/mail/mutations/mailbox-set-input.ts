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
  ...context
}: MailboxSetContext & {
  clientId: string;
  name: string;
}) {
  return {
    ...base(context),
    create: {
      [clientId]: {
        name,
        kind: 'label' as const,
        role: null,
        parentId: null,
      },
    },
  };
}

export function buildUpdateMailboxInput({
  mailboxId,
  name,
  color,
  ...context
}: MailboxSetContext & {
  mailboxId: string;
  name?: string;
  color?: string | null;
}) {
  return {
    ...base(context),
    update: {
      [mailboxId]: {
        ...(name === undefined ? {} : { name }),
        ...(color === undefined ? {} : { color }),
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
