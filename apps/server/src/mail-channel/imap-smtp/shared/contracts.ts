import { z } from 'zod';

const MAX_RAW_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_RAW_BASE64_LENGTH = Math.ceil(MAX_RAW_MESSAGE_BYTES / 3) * 4;

const endpointSchema = z
  .object({
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    secure: z.boolean(),
  })
  .strict();

export const imapSmtpCredentialSchema = z
  .object({
    type: z.literal('imap_smtp'),
    email: z.string().trim().email().max(320),
    username: z.string().min(1).max(512),
    password: z.string().min(1).max(4096),
    imap: endpointSchema,
    smtp: endpointSchema,
  })
  .strict();

const inboxSchema = z.literal('INBOX');
const uidValiditySchema = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .max(32);
const uidSchema = z.number().int().min(1).max(0xffff_ffff);
const optionalModseqSchema = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .max(32)
  .nullable();
const isoDateSchema = z.string().datetime({ offset: true });
const messageIdSchema = z
  .string()
  .min(3)
  .max(998)
  .regex(/^<[^\u0000-\u0020\u007f<>]+>$/u);

const isBase64Character = (code: number): boolean =>
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) ||
  (code >= 0x30 && code <= 0x39) ||
  code === 0x2b ||
  code === 0x2f;

export const isValidBase64 = (value: string): boolean => {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    if (!isBase64Character(value.charCodeAt(index))) return false;
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x3d) return false;
  }
  return true;
};

const rawMimeBase64Schema = z
  .string()
  .min(1)
  .max(MAX_RAW_BASE64_LENGTH)
  .refine(isValidBase64, { message: 'Invalid Base64 MIME payload' });

export const imapBaselineRequestSchema = z
  .object({
    credential: imapSmtpCredentialSchema,
    mailbox: inboxSchema,
  })
  .strict();

export const protocolVerifyRequestSchema = z
  .object({
    credential: imapSmtpCredentialSchema,
  })
  .strict();

export const protocolVerifyResponseSchema = z
  .object({
    email: z.string().email().max(320),
  })
  .strict();

export const imapBaselineResponseSchema = z
  .object({
    uidValidity: uidValiditySchema,
    uidNext: uidSchema,
    highestModseq: optionalModseqSchema,
  })
  .strict();

export const imapPageCursorSchema = z
  .object({
    mode: z.enum(['uid', 'recovery']),
    uidValidity: uidValiditySchema,
    nextUid: uidSchema,
    upperUid: z.number().int().min(0).max(0xffff_ffff),
    receivedSince: isoDateSchema.optional(),
  })
  .strict()
  .superRefine((cursor, context) => {
    if (cursor.nextUid > cursor.upperUid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'nextUid must not exceed upperUid',
      });
    }
    if (cursor.mode === 'recovery' && cursor.receivedSince === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Recovery cursors require receivedSince',
      });
    }
  });

export const imapDiscoverRequestSchema = z
  .object({
    credential: imapSmtpCredentialSchema,
    mailbox: inboxSchema,
    expectedUidValidity: uidValiditySchema,
    nextUid: uidSchema,
    lastSuccessfulAt: isoDateSchema,
    cursor: imapPageCursorSchema.nullable(),
    limit: z.number().int().min(1).max(200),
  })
  .strict();

const imapDiscoveredMessageSchema = z
  .object({
    uid: uidSchema,
    messageId: messageIdSchema.nullable(),
    receivedAt: isoDateSchema.nullable(),
  })
  .strict();

export const imapDiscoverResponseSchema = z
  .object({
    uidValidity: uidValiditySchema,
    uidNext: uidSchema,
    highestModseq: optionalModseqSchema,
    scanUpperUid: z.number().int().min(0).max(0xffff_ffff),
    reset: z.boolean(),
    messages: z.array(imapDiscoveredMessageSchema).max(200),
    nextCursor: imapPageCursorSchema.nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.nextCursor !== null && page.nextCursor.upperUid !== page.scanUpperUid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cursor boundary does not match the page boundary',
      });
    }
    if (page.messages.some(({ uid }) => uid > page.scanUpperUid)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Message UID exceeds the scan boundary',
      });
    }
  });

export const imapRawRequestSchema = z
  .object({
    credential: imapSmtpCredentialSchema,
    mailbox: inboxSchema,
    uidValidity: uidValiditySchema,
    uid: uidSchema,
  })
  .strict();

export const imapRawResponseSchema = z
  .object({
    uidValidity: uidValiditySchema,
    uid: uidSchema,
    rawMimeBase64: rawMimeBase64Schema,
    receivedAt: isoDateSchema.nullable(),
  })
  .strict();

const smtpEnvelopeSchema = z
  .object({
    from: z.string().min(1).max(512),
    to: z.array(z.string().min(1).max(512)).min(1).max(500),
  })
  .strict();

export const smtpSendRequestSchema = z
  .object({
    credential: imapSmtpCredentialSchema,
    envelope: smtpEnvelopeSchema,
    rawMimeBase64: rawMimeBase64Schema,
    messageId: messageIdSchema,
  })
  .strict();

export const smtpSendResponseSchema = z
  .object({
    accepted: z.literal(true),
    responseCode: z.number().int().min(200).max(299),
    providerResponse: z.string().max(512).nullable(),
  })
  .strict();

export const protocolWorkerProblemSchema = z
  .object({
    error: z
      .object({
        code: z
          .string()
          .regex(/^[A-Z0-9_]+$/u)
          .max(128),
        classification: z.enum(['authentication', 'retryable', 'permanent', 'uncertain']),
      })
      .strict(),
  })
  .strict();

export type ImapSmtpCredentialInput = z.infer<typeof imapSmtpCredentialSchema>;
export type ProtocolVerifyRequest = z.infer<typeof protocolVerifyRequestSchema>;
export type ProtocolVerifyResponse = z.infer<typeof protocolVerifyResponseSchema>;
export type ImapBaselineRequest = z.infer<typeof imapBaselineRequestSchema>;
export type ImapBaselineResponse = z.infer<typeof imapBaselineResponseSchema>;
export type ImapPageCursor = z.infer<typeof imapPageCursorSchema>;
export type ImapDiscoverRequest = z.infer<typeof imapDiscoverRequestSchema>;
export type ImapDiscoverResponse = z.infer<typeof imapDiscoverResponseSchema>;
export type ImapRawRequest = z.infer<typeof imapRawRequestSchema>;
export type ImapRawResponse = z.infer<typeof imapRawResponseSchema>;
export type SmtpSendRequest = z.infer<typeof smtpSendRequestSchema>;
export type SmtpSendResponse = z.infer<typeof smtpSendResponseSchema>;
export type ProtocolWorkerProblem = z.infer<typeof protocolWorkerProblemSchema>;

export const parseProtocolVerifyRequest = (value: unknown): ProtocolVerifyRequest =>
  protocolVerifyRequestSchema.parse(value);
export const parseProtocolVerifyResponse = (value: unknown): ProtocolVerifyResponse =>
  protocolVerifyResponseSchema.parse(value);
export const parseImapBaselineRequest = (value: unknown): ImapBaselineRequest =>
  imapBaselineRequestSchema.parse(value);
export const parseImapBaselineResponse = (value: unknown): ImapBaselineResponse =>
  imapBaselineResponseSchema.parse(value);
export const parseImapDiscoverRequest = (value: unknown): ImapDiscoverRequest =>
  imapDiscoverRequestSchema.parse(value);
export const parseImapDiscoverResponse = (value: unknown): ImapDiscoverResponse =>
  imapDiscoverResponseSchema.parse(value);
export const parseImapRawRequest = (value: unknown): ImapRawRequest =>
  imapRawRequestSchema.parse(value);
export const parseImapRawResponse = (value: unknown): ImapRawResponse =>
  imapRawResponseSchema.parse(value);
export const parseSmtpSendRequest = (value: unknown): SmtpSendRequest =>
  smtpSendRequestSchema.parse(value);
export const parseSmtpSendResponse = (value: unknown): SmtpSendResponse =>
  smtpSendResponseSchema.parse(value);
