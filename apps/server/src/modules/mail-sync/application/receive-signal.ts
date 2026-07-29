import type { MailIngressCommand } from './commands';

export const receiveInboundSignal = async (
  input: {
    provider: string;
    externalAccount: string;
    cursorHint?: string;
  },
  dependencies: {
    recordSignal(input: {
      provider: string;
      externalAccount: string;
      cursorHint?: string;
    }): Promise<string[]>;
    enqueue(command: MailIngressCommand): Promise<void>;
  },
): Promise<{ matched: number }> => {
  const normalized = input.externalAccount.trim().toLocaleLowerCase('und');
  const syncIds = await dependencies.recordSignal({
    provider: input.provider,
    externalAccount: normalized,
    ...(input.cursorHint === undefined ? {} : { cursorHint: input.cursorHint }),
  });
  await Promise.all(syncIds.map((syncId) => dependencies.enqueue({ type: 'discover', syncId })));
  return { matched: syncIds.length };
};

export const receiveSubscriptionSignal = async (
  input: {
    provider: string;
    subscriptionExternalId: string;
    cursorHint?: string;
  },
  dependencies: {
    recordSubscriptionSignal(input: {
      provider: string;
      subscriptionExternalId: string;
      cursorHint?: string;
    }): Promise<string[]>;
    enqueue(command: MailIngressCommand): Promise<void>;
  },
): Promise<{ matched: number }> => {
  const syncIds = await dependencies.recordSubscriptionSignal(input);
  await Promise.all(syncIds.map((syncId) => dependencies.enqueue({ type: 'discover', syncId })));
  return { matched: syncIds.length };
};
