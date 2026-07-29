import { z } from 'zod';

const microsoftTenant =
  /^(?:common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/iu;

export const outlookChannelConfigInputSchema = z.object({
  authSource: z.enum(['zero_oauth', 'nango']),
  inboxWatchEnabled: z.boolean(),
  scheduledSyncEnabled: z.boolean(),
  syncIntervalMinutes: z.number().int().min(1).max(1440),
  providerConfig: z.object({
    tenantId: z.string().trim().regex(microsoftTenant).default('common'),
  }),
});

export type OutlookChannelConfig = z.infer<typeof outlookChannelConfigInputSchema> & {
  channelId: 'outlook';
};

export const defaultOutlookChannelConfig: OutlookChannelConfig = {
  channelId: 'outlook',
  authSource: 'zero_oauth',
  inboxWatchEnabled: true,
  scheduledSyncEnabled: true,
  syncIntervalMinutes: 10,
  providerConfig: { tenantId: 'common' },
};

export const parseOutlookChannelConfig = (value: unknown): OutlookChannelConfig => {
  const record = z
    .object({ channelId: z.literal('outlook') })
    .passthrough()
    .parse(value);
  return {
    channelId: record.channelId,
    ...outlookChannelConfigInputSchema.parse(record),
  };
};
