import { createMailProtocolWorkerClient } from '../../mail-channel/imap-smtp/shared/protocol-client';
import type { ImapSmtpCredential } from '../../mail-channel/contracts';
import { createImapSmtpPlugin } from '../../mail-channel/imap-smtp';
import type { ZeroEnv } from '../../env';

export const createImapSmtpPluginForEnvironment = (runtimeEnv: ZeroEnv) =>
  createImapSmtpPlugin({
    createClient: async (credential: ImapSmtpCredential) => {
      if (
        runtimeEnv.MAIL_PROTOCOL_WORKER_URL === undefined ||
        runtimeEnv.MAIL_PROTOCOL_WORKER_SECRET === undefined
      ) {
        throw new Error('MAIL_PROTOCOL_WORKER_NOT_CONFIGURED');
      }
      return createMailProtocolWorkerClient({
        baseUrl: runtimeEnv.MAIL_PROTOCOL_WORKER_URL,
        secret: runtimeEnv.MAIL_PROTOCOL_WORKER_SECRET,
        credential,
      });
    },
    clock: { now: () => new Date() },
  });
