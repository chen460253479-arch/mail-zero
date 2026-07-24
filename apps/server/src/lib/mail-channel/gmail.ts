import { GoogleMailManager } from '../driver/google';
import { gmailSyncAdapter } from './gmail-sync';
import type { MailboxChannel } from './types';

export const gmailChannel: MailboxChannel = {
  id: 'gmail',
  displayName: 'Gmail',
  capabilities: new Set([
    'read_messages',
    'send_messages',
    'drafts',
    'attachments',
    'labels',
    'threads',
    'push_sync',
  ]),
  sync: gmailSyncAdapter,
  createClient: (config) => new GoogleMailManager(config),
  resolveIdentity: async (config) => {
    const identity = await new GoogleMailManager(config).getUserInfo();
    return {
      email: identity.address,
      name: identity.name,
      picture: identity.photo,
    };
  },
  getScope: (config) => new GoogleMailManager(config).getScope(),
  revoke: (config, token) => new GoogleMailManager(config).revokeToken(token),
};
