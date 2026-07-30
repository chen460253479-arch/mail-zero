import { z } from 'zod';

import { mailChannelIds } from '../../../mail-channel/contracts';

export const externalUserIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/);

export const externalBindInputSchema = z
  .object({
    externalUserId: externalUserIdSchema,
    channelId: z.enum(mailChannelIds),
    connectionId: z.string().trim().min(1),
  })
  .strict();

export type ExternalBindInput = z.infer<typeof externalBindInputSchema>;
