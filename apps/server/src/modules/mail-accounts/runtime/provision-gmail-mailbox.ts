import type { MailAccountId } from '@zero/mail-core';

import { createPostgresConnectionRepository } from '../postgres/connection-repository';
import { activateGmailInboundForAccount } from '../../../runtime/mail/gmail-inbound';
import { PostgresMailUnitOfWork } from '../../mail/postgres/postgres-unit-of-work';
import { createMailCoreForEnvironment } from '../../../runtime/mail/core';
import { provisionMailbox } from '../application/provision-mailbox';
import type { ZeroEnv } from '../../../env';
import type { DB } from '../../../db';

export const provisionGmailMailboxInDatabase = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  input: {
    userId: string;
    connectionId: string;
    identity: {
      email: string;
      name: string;
    };
  },
): Promise<{ accountId: string; identityId: string }> => {
  const unitOfWork = new PostgresMailUnitOfWork(db);
  const mailCore = createMailCoreForEnvironment(db, runtimeEnv);
  const connectionRepository = createPostgresConnectionRepository(db);

  return await provisionMailbox(input, {
    findAccountByConnectionId: (connectionId) =>
      unitOfWork.run((transaction) => transaction.accounts.findByConnectionId(connectionId)),
    createAccount: (createInput) => mailCore.createAccount(createInput),
    listIdentities: (accountId) =>
      mailCore.listIdentities({ accountId: accountId as MailAccountId }),
    createIdentity: (identity) =>
      mailCore.createIdentity({
        ...identity,
        accountId: identity.accountId as MailAccountId,
      }),
    activateInbound: ({ connectionId, accountId }) =>
      activateGmailInboundForAccount(db, runtimeEnv, { connectionId, accountId }),
    markReconnectRequired: (connectionId) =>
      connectionRepository.markReconnectRequired(input.userId, connectionId),
  });
};
