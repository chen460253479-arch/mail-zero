import { z } from 'zod';

import { mailChannelIds } from '../../../mail-channel/contracts';

export const externalBindInputSchema = z
  .object({
    channelId: z.enum(mailChannelIds),
    connectionId: z.string().trim().min(1),
  })
  .strict();

export type ExternalBindInput = z.infer<typeof externalBindInputSchema>;
