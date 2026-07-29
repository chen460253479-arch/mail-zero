import { z } from 'zod';

export const imapSmtpChannelConfigInputSchema = z.object({
  authSource: z.enum(['manual', 'nango']),
  inboxWatchEnabled: z.literal(false),
  scheduledSyncEnabled: z.boolean(),
  syncIntervalMinutes: z.number().int().min(1).max(1440),
  providerConfig: z.object({}),
});

export type ImapSmtpChannelConfig = z.infer<typeof imapSmtpChannelConfigInputSchema> & {
  channelId: 'imap_smtp';
};

export const defaultImapSmtpChannelConfig: ImapSmtpChannelConfig = {
  channelId: 'imap_smtp',
  authSource: 'manual',
  inboxWatchEnabled: false,
  scheduledSyncEnabled: true,
  syncIntervalMinutes: 10,
  providerConfig: {},
};

export const parseImapSmtpChannelConfig = (value: unknown): ImapSmtpChannelConfig => {
  const record = z
    .object({ channelId: z.literal('imap_smtp') })
    .passthrough()
    .parse(value);
  return {
    channelId: record.channelId,
    ...imapSmtpChannelConfigInputSchema.parse(record),
  };
};
