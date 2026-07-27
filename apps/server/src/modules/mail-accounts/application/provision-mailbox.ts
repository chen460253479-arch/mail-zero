import { normalizeMailboxEmail } from './mailbox-identity';

type LocalMailAccount = {
  id: string;
  userId: string;
  connectionId: string;
};

type LocalMailIdentity = {
  id: string;
  email: string;
  isDefault: boolean;
};

type ProvisionMailboxDependencies = {
  findAccountByConnectionId(connectionId: string): Promise<LocalMailAccount | null>;
  createAccount(input: {
    userId: string;
    connectionId: string;
    timezone: string;
    storageQuotaBytes: bigint | null;
  }): Promise<LocalMailAccount>;
  listIdentities(accountId: string): Promise<LocalMailIdentity[]>;
  createIdentity(input: {
    accountId: string;
    name: string | null;
    email: string;
    replyTo: null;
    makeDefault: boolean;
  }): Promise<LocalMailIdentity>;
  activateInbound(input: { connectionId: string; accountId: string }): Promise<void>;
  markReconnectRequired(connectionId: string): Promise<void>;
};

const ensureAccount = async (
  input: {
    userId: string;
    connectionId: string;
  },
  dependencies: ProvisionMailboxDependencies,
): Promise<LocalMailAccount> => {
  const existing = await dependencies.findAccountByConnectionId(input.connectionId);
  if (existing !== null) return existing;
  try {
    return await dependencies.createAccount({
      ...input,
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
  } catch (error) {
    const concurrentlyCreated = await dependencies.findAccountByConnectionId(input.connectionId);
    if (concurrentlyCreated !== null) return concurrentlyCreated;
    throw error;
  }
};

const ensureIdentity = async (
  input: {
    accountId: string;
    email: string;
    name: string;
  },
  dependencies: ProvisionMailboxDependencies,
): Promise<LocalMailIdentity> => {
  const normalizedEmail = normalizeMailboxEmail(input.email);
  const findIdentity = async () =>
    (await dependencies.listIdentities(input.accountId)).find(
      (identity) => normalizeMailboxEmail(identity.email) === normalizedEmail,
    ) ?? null;
  const existing = await findIdentity();
  if (existing !== null) return existing;

  try {
    return await dependencies.createIdentity({
      accountId: input.accountId,
      name: input.name.trim() || null,
      email: normalizedEmail,
      replyTo: null,
      makeDefault: true,
    });
  } catch (error) {
    const concurrentlyCreated = await findIdentity();
    if (concurrentlyCreated !== null) return concurrentlyCreated;
    throw error;
  }
};

export const provisionMailbox = async (
  input: {
    userId: string;
    connectionId: string;
    identity: {
      email: string;
      name: string;
    };
  },
  dependencies: ProvisionMailboxDependencies,
): Promise<{ accountId: string; identityId: string }> => {
  const account = await ensureAccount(input, dependencies);
  const identity = await ensureIdentity(
    {
      accountId: account.id,
      ...input.identity,
    },
    dependencies,
  );

  try {
    await dependencies.activateInbound({
      connectionId: input.connectionId,
      accountId: account.id,
    });
  } catch (error) {
    await dependencies.markReconnectRequired(input.connectionId);
    throw error;
  }

  return {
    accountId: account.id,
    identityId: identity.id,
  };
};
