import { z } from 'zod';

import {
  changesInputSchema,
  isoDateSchema,
  mailAccountIdSchema,
  mailIdSchema,
  nullableIsoDateSchema,
  setErrorSchema,
  stateSchema,
} from './common';

export const submissionStatusSchema = z.enum(['scheduled', 'queued', 'sent', 'failed', 'canceled']);

export const submissionSchema = z.object({
  id: mailIdSchema,
  emailId: mailIdSchema,
  identityId: mailIdSchema,
  status: submissionStatusSchema,
  sendAt: isoDateSchema,
  draftRevision: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  sentAt: nullableIsoDateSchema,
});

export const submissionGetInputSchema = z.object({
  accountId: mailAccountIdSchema,
  ids: z.array(mailIdSchema).min(1).max(200),
});

export const submissionQueryInputSchema = z.object({
  accountId: mailAccountIdSchema,
  status: submissionStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const submissionCreateSchema = z.object({
  emailId: mailIdSchema,
  identityId: mailIdSchema,
  sendAt: nullableIsoDateSchema.optional(),
  idempotencyKey: z.string().min(1).max(255),
});

export const submissionSetInputSchema = z.object({
  accountId: mailAccountIdSchema,
  ifInState: stateSchema.optional(),
  create: z.record(z.string().min(1), submissionCreateSchema).default({}),
  destroy: z.array(mailIdSchema).max(200).default([]),
});

export const submissionSetResultSchema = z.object({
  accountId: mailAccountIdSchema,
  oldState: stateSchema,
  newState: stateSchema,
  created: z.record(z.string(), submissionSchema),
  destroyed: z.array(mailIdSchema),
  notCreated: z.record(z.string(), setErrorSchema),
  notDestroyed: z.record(z.string(), setErrorSchema),
});

export const submissionChangesInputSchema = changesInputSchema;
