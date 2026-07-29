import { z } from 'zod';

const googleTopicName = /^projects\/[^/]+\/topics\/[^/]+$/u;

const providerConfigFields = {
  topicName: z.string().regex(googleTopicName).optional(),
};

const commonGmailChannelConfig = z.object({
  authSource: z.enum(['zero_oauth', 'nango']),
  scheduledSyncEnabled: z.boolean(),
  syncIntervalMinutes: z.number().int().min(1).max(1440),
});

export const gmailChannelConfigInputSchema = z.discriminatedUnion('inboxWatchEnabled', [
  commonGmailChannelConfig.extend({
    inboxWatchEnabled: z.literal(false),
    providerConfig: z.object(providerConfigFields),
  }),
  commonGmailChannelConfig.extend({
    inboxWatchEnabled: z.literal(true),
    providerConfig: z.object({
      topicName: z.string().regex(googleTopicName),
    }),
  }),
]);

export type GmailAuthSource = 'zero_oauth' | 'nango';

export type GmailChannelProviderConfig = {
  topicName?: string;
};

export type GmailChannelConfig = z.infer<typeof gmailChannelConfigInputSchema> & {
  channelId: 'gmail';
};

export const defaultGmailChannelConfig: GmailChannelConfig = {
  channelId: 'gmail',
  authSource: 'zero_oauth',
  inboxWatchEnabled: false,
  scheduledSyncEnabled: true,
  syncIntervalMinutes: 10,
  providerConfig: {},
};

export const parseGmailChannelConfig = (value: unknown): GmailChannelConfig => {
  const record = z
    .object({ channelId: z.literal('gmail') })
    .passthrough()
    .parse(value);
  return {
    channelId: record.channelId,
    ...gmailChannelConfigInputSchema.parse(record),
  };
};
