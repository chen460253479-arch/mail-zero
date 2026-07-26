type LocalMailAccount = {
  id: string;
  userId: string;
  connectionId: string;
};

type BootstrapDependencies = {
  findByConnectionId(connectionId: string): Promise<LocalMailAccount | null>;
  createAccount(input: {
    userId: string;
    connectionId: string;
    timezone: string;
    storageQuotaBytes: bigint | null;
  }): Promise<LocalMailAccount>;
};

export const bootstrapLocalMailAccount = async (
  input: {
    userId: string;
    connectionId: string;
    timezone?: string;
    storageQuotaBytes?: bigint | null;
  },
  dependencies: BootstrapDependencies,
): Promise<LocalMailAccount> => {
  const existing = await dependencies.findByConnectionId(input.connectionId);
  if (existing !== null) {
    return existing;
  }

  try {
    return await dependencies.createAccount({
      userId: input.userId,
      connectionId: input.connectionId,
      timezone: input.timezone ?? 'UTC',
      storageQuotaBytes: input.storageQuotaBytes ?? null,
    });
  } catch (error) {
    const concurrent = await dependencies.findByConnectionId(input.connectionId);
    if (concurrent !== null) {
      return concurrent;
    }
    throw error;
  }
};
