import { TRPCError } from '@trpc/server';

import { GmailOAuthError } from '../../lib/integrations/gmail-oauth-service';
import { NangoIntegrationError } from '../../lib/integrations/nango-service';

export const mapIntegrationError = (error: unknown): never => {
  if (error instanceof NangoIntegrationError || error instanceof GmailOAuthError) {
    throw new TRPCError({
      code: error.code === 'INTEGRATION_IN_USE' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.code,
    });
  }
  throw error;
};
