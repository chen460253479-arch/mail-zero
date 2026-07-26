import { z } from 'zod';

import {
  changesInputSchema,
  enforceSetOperationLimit,
  mailAccountIdSchema,
  mailIdSchema,
  setErrorSchema,
  stateSchema,
} from './common';

export const identitySchema = z.object({
  id: mailIdSchema,
  name: z.string().nullable(),
  email: z.string().min(1),
  replyTo: z.string().nullable(),
  isDefault: z.boolean(),
});

export const identityGetInputSchema = z.object({
  accountId: mailAccountIdSchema,
  ids: z.array(mailIdSchema).max(200).optional(),
});

export const identityCreateSchema = z.object({
  name: z.string().nullable(),
  email: z.string().min(1),
  replyTo: z.string().nullable(),
  makeDefault: z.boolean().default(false),
});

export const identityUpdateSchema = identityCreateSchema.partial();

export const identitySetInputSchema = z
  .object({
    accountId: mailAccountIdSchema,
    ifInState: stateSchema.optional(),
    create: z.record(z.string().min(1), identityCreateSchema).default({}),
    update: z.record(mailIdSchema, identityUpdateSchema).default({}),
    destroy: z.array(mailIdSchema).max(200).default([]),
  })
  .superRefine(enforceSetOperationLimit);

export const identitySetResultSchema = z.object({
  accountId: mailAccountIdSchema,
  oldState: stateSchema,
  newState: stateSchema,
  created: z.record(z.string(), identitySchema),
  updated: z.record(z.string(), identitySchema),
  destroyed: z.array(mailIdSchema),
  notCreated: z.record(z.string(), setErrorSchema),
  notUpdated: z.record(z.string(), setErrorSchema),
  notDestroyed: z.record(z.string(), setErrorSchema),
});

export const identityGetResultSchema = z.object({
  accountId: mailAccountIdSchema,
  state: stateSchema,
  list: z.array(identitySchema),
  notFound: z.array(mailIdSchema),
});

export const identityChangesInputSchema = changesInputSchema;
