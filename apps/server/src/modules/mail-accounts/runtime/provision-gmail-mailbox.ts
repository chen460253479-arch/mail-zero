import { provisionChannelMailboxInDatabase } from './provision-channel-mailbox';
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
  return await provisionChannelMailboxInDatabase(db, runtimeEnv, {
    ...input,
    channelId: 'gmail',
  });
};
