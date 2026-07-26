import type { MailAccountId, MailAccountRecord, MailCore } from '@zero/mail-core';

import { accountSchema, type AccountDto } from '../contracts/account';

export const toAccountDto = (account: MailAccountRecord): AccountDto =>
  accountSchema.parse({
    ...account,
    state: account.stateVersion,
  });

export const createAccountService = (core: Pick<MailCore, 'getAccount' | 'listAccounts'>) => ({
  async list(input: { userId: string }) {
    return {
      accounts: (await core.listAccounts(input)).map(toAccountDto),
    };
  },
  async get(input: { accountId: string }) {
    return toAccountDto(await core.getAccount({ accountId: input.accountId as MailAccountId }));
  },
});
