import { z } from 'zod';

import { externalUserIdSchema } from './bind';

export const accessGrantInputSchema = z
  .object({
    externalUserId: externalUserIdSchema,
  })
  .strict();

export const accessGrantResponseSchema = z
  .object({
    launchCode: z.string().min(1),
  })
  .strict();

export const launchCodeInputSchema = z
  .object({
    launchCode: z.string().min(1),
  })
  .strict();

export type AccessGrantInput = z.infer<typeof accessGrantInputSchema>;
