import type { MailAccountId } from '@zero/mail-core';

import {
  activateChannelInboundForAccount,
  type MailInboundRuntimeResources,
} from '../../../runtime/mail/inbound';
import { createPostgresConnectionRepository } from '../postgres/connection-repository';
import { PostgresMailUnitOfWork } from '../../mail/postgres/postgres-unit-of-work';
import { createMailCoreForEnvironment } from '../../../runtime/mail/core';
import type { MailChannelId } from '../../../mail-channel/contracts';
import { provisionMailbox } from '../application/provision-mailbox';
import type { DB } from '../../../db';

export const provisionChannelMailboxInDatabase = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  input: {
    userId: string;
    connectionId: string;
    channelId: MailChannelId;
    identity: {
      email: string;
      name: string;
    };
  },
): Promise<{ accountId: string; identityId: string }> => {
  const unitOfWork = new PostgresMailUnitOfWork(db);
  const mailCore = createMailCoreForEnvironment(db, {
    blobStore: resources.blobStore,
    cursorSigningKey: resources.environment.BETTER_AUTH_SECRET,
  });
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
      activateChannelInboundForAccount(db, resources, {
        connectionId,
        accountId,
        channelId: input.channelId,
      }),
    markReconnectRequired: (connectionId) =>
      connectionRepository.markReconnectRequired(input.userId, connectionId),
  });
};
