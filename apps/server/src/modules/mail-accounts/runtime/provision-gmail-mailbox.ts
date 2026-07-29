import type { MailInboundRuntimeResources } from '../../../runtime/mail/inbound';
import { provisionChannelMailboxInDatabase } from './provision-channel-mailbox';
import type { DB } from '../../../db';

export const provisionGmailMailboxInDatabase = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  input: {
    userId: string;
    connectionId: string;
    identity: {
      email: string;
      name: string;
    };
  },
): Promise<{ accountId: string; identityId: string }> => {
  return await provisionChannelMailboxInDatabase(db, resources, {
    ...input,
    channelId: 'gmail',
  });
};
