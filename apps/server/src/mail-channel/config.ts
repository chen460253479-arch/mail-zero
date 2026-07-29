import { z } from 'zod';

import {
  defaultZohoMailChannelConfig,
  parseZohoMailChannelConfig,
  zohoMailChannelConfigInputSchema,
  type ZohoMailChannelConfig,
} from './zoho-mail/config';
import {
  defaultImapSmtpChannelConfig,
  imapSmtpChannelConfigInputSchema,
  parseImapSmtpChannelConfig,
  type ImapSmtpChannelConfig,
} from './imap-smtp/config';
import {
  defaultOutlookChannelConfig,
  outlookChannelConfigInputSchema,
  parseOutlookChannelConfig,
  type OutlookChannelConfig,
} from './outlook/config';
import {
  defaultGmailChannelConfig,
  gmailChannelConfigInputSchema,
  parseGmailChannelConfig,
  type GmailChannelConfig,
} from './gmail/config';
import type { MailChannelId } from './contracts';

export const mailChannelConfigInputSchema = z.union([
  z.object({ channelId: z.literal('gmail') }).and(gmailChannelConfigInputSchema),
  z.object({ channelId: z.literal('outlook') }).and(outlookChannelConfigInputSchema),
  z.object({ channelId: z.literal('zoho_mail') }).and(zohoMailChannelConfigInputSchema),
  z.object({ channelId: z.literal('imap_smtp') }).and(imapSmtpChannelConfigInputSchema),
]);

export type MailChannelConfig =
  | GmailChannelConfig
  | OutlookChannelConfig
  | ZohoMailChannelConfig
  | ImapSmtpChannelConfig;

export type MailChannelConfigInput = z.infer<typeof mailChannelConfigInputSchema>;

export const defaultMailChannelConfig = (channelId: MailChannelId): MailChannelConfig => {
  switch (channelId) {
    case 'gmail':
      return defaultGmailChannelConfig;
    case 'outlook':
      return defaultOutlookChannelConfig;
    case 'zoho_mail':
      return defaultZohoMailChannelConfig;
    case 'imap_smtp':
      return defaultImapSmtpChannelConfig;
  }
};

export const parseMailChannelConfig = (
  channelId: MailChannelId,
  value: unknown,
): MailChannelConfig => {
  switch (channelId) {
    case 'gmail':
      return parseGmailChannelConfig(value);
    case 'outlook':
      return parseOutlookChannelConfig(value);
    case 'zoho_mail':
      return parseZohoMailChannelConfig(value);
    case 'imap_smtp':
      return parseImapSmtpChannelConfig(value);
  }
};
