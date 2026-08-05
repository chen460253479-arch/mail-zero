import { z } from 'zod';

import {
  booleanIdMapSchema,
  cursorSchema,
  decimalStringSchema,
  enforceSetOperationLimit,
  isoDateSchema,
  mailAccountIdSchema,
  mailAddressSchema,
  mailIdSchema,
  nullableBooleanIdMapSchema,
  nullableIsoDateSchema,
  setErrorSchema,
  stateSchema,
} from './common';
import { customerMarkerSchema } from './customer-marker';

export const emailLifecycleSchema = z.enum(['draft', 'received', 'sent']);

export const emailPartSchema = z.object({
  id: mailIdSchema,
  parentPartId: mailIdSchema.nullable(),
  partPath: z.string(),
  contentType: z.string(),
  charset: z.string().nullable(),
  disposition: z.enum(['inline', 'attachment']).nullable(),
  filename: z.string().nullable(),
  contentId: z.string().nullable(),
  blobId: mailIdSchema.nullable(),
  size: decimalStringSchema,
  kind: z.enum(['body', 'inline', 'attachment']),
});

export const bodyValueSchema = z.object({
  value: z.string(),
  isTruncated: z.boolean(),
});

export const emailSchema = z.object({
  id: mailIdSchema,
  threadId: mailIdSchema,
  blobId: mailIdSchema.nullable(),
  mailboxIds: booleanIdMapSchema,
  keywords: booleanIdMapSchema,
  lifecycle: emailLifecycleSchema,
  draftRevision: z.number().int().nonnegative(),
  messageId: z.string().nullable(),
  inReplyTo: z.array(z.string()),
  references: z.array(z.string()),
  sender: z.array(mailAddressSchema),
  from: z.array(mailAddressSchema),
  replyTo: z.array(mailAddressSchema),
  to: z.array(mailAddressSchema),
  cc: z.array(mailAddressSchema),
  bcc: z.array(mailAddressSchema),
  subject: z.string(),
  preview: z.string(),
  sentAt: nullableIsoDateSchema,
  receivedAt: isoDateSchema,
  size: decimalStringSchema,
  hasAttachment: z.boolean(),
  textBody: z.array(emailPartSchema),
  htmlBody: z.array(emailPartSchema),
  attachments: z.array(emailPartSchema),
  bodyValues: z.record(mailIdSchema, bodyValueSchema),
  customerMarker: customerMarkerSchema.nullable().optional(),
});

const draftAttachmentSchema = z.object({
  blobId: mailIdSchema,
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((filename) => filename.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(filename)),
});

export const draftContentSchema = z.object({
  identityId: mailIdSchema,
  replyToEmailId: mailIdSchema.nullable(),
  to: z.array(mailAddressSchema).max(500),
  cc: z.array(mailAddressSchema).max(500),
  bcc: z.array(mailAddressSchema).max(500),
  subject: z.string().max(998),
  textBody: z.string(),
  htmlBody: z.string(),
  attachments: z.array(draftAttachmentSchema).max(100),
});

export const emailPatchSchema = draftContentSchema.partial().extend({
  mailboxIds: nullableBooleanIdMapSchema.optional(),
  keywords: nullableBooleanIdMapSchema.optional(),
  ifDraftRevision: z.number().int().nonnegative().optional(),
});

export const emailPropertySchema = z.enum([
  'id',
  'threadId',
  'blobId',
  'mailboxIds',
  'keywords',
  'lifecycle',
  'draftRevision',
  'messageId',
  'inReplyTo',
  'references',
  'sender',
  'from',
  'replyTo',
  'to',
  'cc',
  'bcc',
  'subject',
  'preview',
  'sentAt',
  'receivedAt',
  'size',
  'hasAttachment',
  'textBody',
  'htmlBody',
  'attachments',
  'bodyValues',
]);

export const emailGetInputSchema = z.object({
  accountId: mailAccountIdSchema,
  ids: z.array(mailIdSchema).min(1).max(200),
  properties: z.array(emailPropertySchema).max(27).optional(),
  fetchTextBodyValues: z.boolean().default(false),
  fetchHTMLBodyValues: z.boolean().default(false),
  maxBodyValueBytes: z.number().int().min(1).max(1_000_000).default(256_000),
});

export const emailQueryInputSchema = z.object({
  accountId: mailAccountIdSchema,
  filter: z
    .object({
      inMailbox: mailIdSchema.optional(),
      hasKeyword: z.string().min(1).optional(),
      notKeyword: z.string().min(1).optional(),
      lifecycle: emailLifecycleSchema.optional(),
      after: isoDateSchema.optional(),
      before: isoDateSchema.optional(),
      address: z.string().min(1).optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      hasAttachment: z.boolean().optional(),
      text: z.string().min(1).optional(),
    })
    .default({}),
  sort: z
    .array(
      z.object({
        property: z.enum(['receivedAt', 'sentAt', 'size', 'subject']),
        isAscending: z.boolean().default(false),
      }),
    )
    .max(1)
    .default([]),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  calculateTotal: z.boolean().default(false),
});

export const emailChangesInputSchema = z.object({
  accountId: mailAccountIdSchema,
  sinceState: stateSchema,
  maxChanges: z.number().int().min(1).max(1000).default(100),
});

export const emailSetInputSchema = z
  .object({
    accountId: mailAccountIdSchema,
    ifInState: stateSchema.optional(),
    create: z.record(z.string().min(1), draftContentSchema).default({}),
    update: z.record(mailIdSchema, emailPatchSchema).default({}),
    destroy: z.array(mailIdSchema).max(200).default([]),
  })
  .superRefine(enforceSetOperationLimit);

export const emailSetResultSchema = z.object({
  accountId: mailAccountIdSchema,
  oldState: stateSchema,
  newState: stateSchema,
  created: z.record(z.string(), emailSchema),
  updated: z.record(z.string(), emailSchema),
  destroyed: z.array(mailIdSchema),
  notCreated: z.record(z.string(), setErrorSchema),
  notUpdated: z.record(z.string(), setErrorSchema),
  notDestroyed: z.record(z.string(), setErrorSchema),
});

export const emailGetResultSchema = z.object({
  accountId: mailAccountIdSchema,
  state: stateSchema,
  list: z.array(emailSchema.partial().required({ id: true })),
  notFound: z.array(mailIdSchema),
});

export const emailQueryResultSchema = z.object({
  accountId: mailAccountIdSchema,
  queryState: stateSchema,
  ids: z.array(mailIdSchema),
  cursor: cursorSchema.nullable(),
  total: z.number().int().nonnegative().nullable(),
});
