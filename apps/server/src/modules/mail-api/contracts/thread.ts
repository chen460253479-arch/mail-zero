import { z } from 'zod';

import { changesInputSchema, mailAccountIdSchema, mailIdSchema, stateSchema } from './common';

export const threadSchema = z.object({
  id: mailIdSchema,
  emailIds: z.array(mailIdSchema),
});

export const threadGetInputSchema = z.object({
  accountId: mailAccountIdSchema,
  ids: z.array(mailIdSchema).min(1).max(200),
});

export const threadChangesInputSchema = changesInputSchema;

export const threadGetResultSchema = z.object({
  accountId: mailAccountIdSchema,
  state: stateSchema,
  list: z.array(threadSchema),
  notFound: z.array(mailIdSchema),
});
