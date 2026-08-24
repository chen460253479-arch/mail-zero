import { z } from 'zod';

import {
  cursorSchema,
  mailAccountIdSchema,
  mailAddressSchema,
  mailIdSchema,
  stateSchema,
} from './common';
import { emailLifecycleSchema, emailSchema } from './email';
import { customerMarkerSchema } from './customer-marker';

export const threadPageInputSchema = z.object({
  accountId: mailAccountIdSchema,
  mailboxId: mailIdSchema.optional(),
  text: z.string().min(1).optional(),
  hasKeyword: z.string().min(1).optional(),
  hasKeywords: z.array(z.string().min(1)).max(50).optional(),
  hasMailboxIds: z.array(mailIdSchema).max(50).optional(),
  unreadOnly: z.literal(true).optional(),
  lifecycle: emailLifecycleSchema.optional(),
  snoozed: z.boolean().optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const threadSummarySchema = z.object({
  id: mailIdSchema,
  emailIds: z.array(mailIdSchema),
  emailCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  hasAttachment: z.boolean(),
  subject: z.string(),
  preview: z.string(),
  participants: z.string().nullable(),
  latestReceivedAt: z.string().datetime({ offset: true }),
  mailboxIds: z.record(mailIdSchema, z.literal(true)),
  keywords: z.record(z.string(), z.literal(true)),
  customerMarkers: z.array(customerMarkerSchema).optional(),
  latestEmail: z.object({
    id: mailIdSchema,
    lifecycle: emailLifecycleSchema,
    receivedAt: z.string().datetime({ offset: true }),
    to: z.array(mailAddressSchema),
  }),
});

export const threadPageResultSchema = z.object({
  accountId: mailAccountIdSchema,
  queryState: stateSchema,
  items: z.array(threadSummarySchema),
  cursor: cursorSchema.nullable(),
});

export const threadDetailInputSchema = z.object({
  accountId: mailAccountIdSchema,
  threadId: mailIdSchema,
  fetchTextBodyValues: z.boolean().default(false),
  fetchHTMLBodyValues: z.boolean().default(false),
  maxBodyValueBytes: z.number().int().min(1).max(1_000_000).default(256_000),
});

export const threadDetailResultSchema = z.object({
  accountId: mailAccountIdSchema,
  state: stateSchema,
  thread: z.object({ id: mailIdSchema, emailIds: z.array(mailIdSchema) }),
  emails: z.array(emailSchema),
});
