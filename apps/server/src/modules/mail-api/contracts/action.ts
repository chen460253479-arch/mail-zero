import { z } from 'zod';

import { mailAccountIdSchema, mailIdSchema, stateSchema } from './common';

export const updateThreadsInputSchema = z.object({
  accountId: mailAccountIdSchema,
  threadIds: z.array(mailIdSchema).min(1).max(200),
  ifInState: stateSchema.optional(),
  addMailboxIds: z.array(mailIdSchema).max(100).default([]),
  removeMailboxIds: z.array(mailIdSchema).max(100).default([]),
  addKeywords: z.array(z.string().min(1)).max(100).default([]),
  removeKeywords: z.array(z.string().min(1)).max(100).default([]),
  clientMutationId: z.string().min(1).max(255),
});

export const snoozeThreadsInputSchema = z.object({
  accountId: mailAccountIdSchema,
  threadIds: z.array(mailIdSchema).min(1).max(200),
  wakeAt: z.string().datetime({ offset: true }),
  clientMutationId: z.string().min(1).max(255),
});

export const unsnoozeThreadsInputSchema = z.object({
  accountId: mailAccountIdSchema,
  threadIds: z.array(mailIdSchema).min(1).max(200),
  clientMutationId: z.string().min(1).max(255),
});
