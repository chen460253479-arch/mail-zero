import { z } from 'zod';

import { mailAccountIdSchema, mailIdSchema } from './common';

export const requestCustomerCreationInputSchema = z
  .object({
    accountId: mailAccountIdSchema,
    messageId: mailIdSchema,
  })
  .strict();

export const requestCustomerCreationResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('accepted'),
      eventId: mailIdSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('alreadyMarked'),
      eventId: z.null(),
    })
    .strict(),
]);
