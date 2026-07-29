import { TRPCError } from '@trpc/server';

import { ChannelOAuthError } from '../../modules/mail-accounts/application/connect-channel-oauth';
import { MailChannelConfigError } from '../../integrations/mail-channel/channel-config-service';
import { GmailOAuthError } from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { GmailChannelConfigError } from '../../integrations/gmail/channel-config-service';
import { NangoIntegrationError } from '../../integrations/nango/errors';

export const mapIntegrationError = (error: unknown): never => {
  if (error instanceof NangoIntegrationError) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: error.message,
    });
  }
  if (error instanceof GmailOAuthError) {
    throw new TRPCError({
      code: error.code === 'INTEGRATION_IN_USE' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.code,
    });
  }
  if (error instanceof ChannelOAuthError) {
    throw new TRPCError({
      code: error.code === 'INTEGRATION_IN_USE' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.code,
    });
  }
  if (error instanceof GmailChannelConfigError) {
    throw new TRPCError({
      code: error.code === 'GMAIL_AUTH_SOURCE_IN_USE' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.code,
    });
  }
  if (error instanceof MailChannelConfigError) {
    throw new TRPCError({
      code: error.code === 'MAIL_CHANNEL_AUTH_SOURCE_IN_USE' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.code,
    });
  }
  throw error;
};
