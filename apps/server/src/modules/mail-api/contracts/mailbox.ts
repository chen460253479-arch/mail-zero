import { z } from 'zod';

import {
  changesInputSchema,
  mailAccountIdSchema,
  mailIdSchema,
  setErrorSchema,
  stateSchema,
} from './common';

export const mailboxKindSchema = z.enum(['system', 'folder', 'label']);
export const mailboxRoleSchema = z.enum([
  'inbox',
  'sent',
  'drafts',
  'trash',
  'junk',
  'archive',
  'outbox',
  'scheduled',
]);

export const mailboxSchema = z.object({
  id: mailIdSchema,
  parentId: mailIdSchema.nullable(),
  name: z.string(),
  kind: mailboxKindSchema,
  role: mailboxRoleSchema.nullable(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  isSubscribed: z.boolean(),
  totalEmails: z.number().int().nonnegative(),
  unreadEmails: z.number().int().nonnegative(),
  totalThreads: z.number().int().nonnegative(),
  unreadThreads: z.number().int().nonnegative(),
});

export const mailboxGetInputSchema = z.object({
  accountId: mailAccountIdSchema,
  ids: z.array(mailIdSchema).max(200).optional(),
});

export const mailboxCreateSchema = z.object({
  name: z.string().min(1).max(255),
  kind: mailboxKindSchema,
  role: mailboxRoleSchema.nullable(),
  parentId: mailIdSchema.nullable(),
});

export const mailboxUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentId: mailIdSchema.nullable().optional(),
  role: mailboxRoleSchema.nullable().optional(),
  color: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isSubscribed: z.boolean().optional(),
});

export const mailboxSetInputSchema = z.object({
  accountId: mailAccountIdSchema,
  ifInState: stateSchema.optional(),
  create: z.record(z.string().min(1), mailboxCreateSchema).default({}),
  update: z.record(mailIdSchema, mailboxUpdateSchema).default({}),
  destroy: z.array(mailIdSchema).max(200).default([]),
});

export const mailboxSetResultSchema = z.object({
  accountId: mailAccountIdSchema,
  oldState: stateSchema,
  newState: stateSchema,
  created: z.record(z.string(), mailboxSchema),
  updated: z.record(z.string(), mailboxSchema),
  destroyed: z.array(mailIdSchema),
  notCreated: z.record(z.string(), setErrorSchema),
  notUpdated: z.record(z.string(), setErrorSchema),
  notDestroyed: z.record(z.string(), setErrorSchema),
});

export const mailboxChangesInputSchema = changesInputSchema;
