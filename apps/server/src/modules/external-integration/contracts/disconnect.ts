import { z } from 'zod';

import { mailChannelIds } from '../../../mail-channel/contracts';
import { externalUserIdSchema } from './bind';

export const externalDisconnectInputSchema = z
  .object({
    externalUserId: externalUserIdSchema,
    channelId: z.enum(mailChannelIds),
    connectionId: z.string().trim().min(1),
  })
  .strict();

export type ExternalDisconnectInput = z.infer<typeof externalDisconnectInputSchema>;
