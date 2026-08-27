import { createImapSmtpProtocolExecutor } from '../../mail-channel/imap-smtp/runtime/protocol-executor';
import { createMailProtocolClient } from '../../mail-channel/imap-smtp/shared/protocol-client';
import type { ImapSmtpCredential } from '../../mail-channel/contracts';
import { createImapSmtpPlugin } from '../../mail-channel/imap-smtp';
import type { Logger } from '../../infrastructure/logging/logger';
import type { ZeroEnv } from '../../env';

export const createImapSmtpPluginForEnvironment = (
  runtimeEnv: ZeroEnv,
  logger?: Pick<Logger, 'info' | 'error'>,
) => {
  const executor = createImapSmtpProtocolExecutor({
    allowedHosts: runtimeEnv.MAIL_PROTOCOL_ALLOWED_HOSTS,
    logger,
  });
  return createImapSmtpPlugin({
    createClient: async (credential: ImapSmtpCredential) => {
      return createMailProtocolClient({
        executor,
        credential,
      });
    },
    clock: { now: () => new Date() },
  });
};
