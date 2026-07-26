import { GmailOutboundError } from './errors';

export const requireGmailMessageId = (value: string | null | undefined): string => {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new GmailOutboundError('GMAIL_INVALID_RESPONSE');
  }
  return normalized;
};
