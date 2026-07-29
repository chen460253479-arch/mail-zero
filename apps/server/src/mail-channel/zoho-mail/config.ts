import { z } from 'zod';

export const zohoDataCenters = ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'] as const;

export const zohoMailChannelConfigInputSchema = z.object({
  authSource: z.enum(['zero_oauth', 'nango']),
  inboxWatchEnabled: z.boolean(),
  scheduledSyncEnabled: z.boolean(),
  syncIntervalMinutes: z.number().int().min(1).max(1440),
  providerConfig: z.object({
    dataCenter: z.enum(zohoDataCenters).default('com'),
  }),
});

export type ZohoMailChannelConfig = z.infer<typeof zohoMailChannelConfigInputSchema> & {
  channelId: 'zoho_mail';
};

export const defaultZohoMailChannelConfig: ZohoMailChannelConfig = {
  channelId: 'zoho_mail',
  authSource: 'zero_oauth',
  inboxWatchEnabled: false,
  scheduledSyncEnabled: true,
  syncIntervalMinutes: 10,
  providerConfig: { dataCenter: 'com' },
};

export const parseZohoMailChannelConfig = (value: unknown): ZohoMailChannelConfig => {
  const record = z
    .object({ channelId: z.literal('zoho_mail') })
    .passthrough()
    .parse(value);
  return {
    channelId: record.channelId,
    ...zohoMailChannelConfigInputSchema.parse(record),
  };
};
