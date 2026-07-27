import { z } from 'zod';

import { mailAccountIdSchema, mailIdSchema, setErrorSchema, stateSchema } from './common';

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

export const destroyThreadsInputSchema = z.object({
  accountId: mailAccountIdSchema,
  threadIds: z.array(mailIdSchema).min(1).max(200),
  ifInState: stateSchema.optional(),
  clientMutationId: z.string().min(1).max(255),
});

export const updateThreadsResultSchema = z.object({
  accountId: mailAccountIdSchema,
  clientMutationId: z.string(),
  oldState: stateSchema,
  newState: stateSchema,
  updatedThreadIds: z.array(mailIdSchema),
  failed: z.record(mailIdSchema, setErrorSchema),
});

export const snoozeThreadsResultSchema = z.object({
  accountId: mailAccountIdSchema,
  clientMutationId: z.string(),
  scheduled: z.array(mailIdSchema),
  failed: z.record(mailIdSchema, setErrorSchema),
});

export const unsnoozeThreadsResultSchema = z.object({
  accountId: mailAccountIdSchema,
  clientMutationId: z.string(),
  restored: z.array(mailIdSchema),
  notFound: z.array(mailIdSchema),
});

export const destroyThreadsResultSchema = z.object({
  accountId: mailAccountIdSchema,
  clientMutationId: z.string(),
  oldState: stateSchema,
  newState: stateSchema,
  destroyedThreadIds: z.array(mailIdSchema),
  failed: z.record(mailIdSchema, setErrorSchema),
});
