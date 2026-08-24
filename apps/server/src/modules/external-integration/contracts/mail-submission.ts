import { z } from 'zod';

import { externalUserIdSchema } from './bind';

export const EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_MIB = 50;
export const EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES =
  EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_MIB * 1024 * 1024;
export const EXTERNAL_MAIL_ATTACHMENT_MAX_COUNT = 100;

const mailAddressSchema = z
  .object({
    name: z.string().max(320).optional(),
    email: z.string().trim().email().max(320),
  })
  .strict();

const attachmentFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((filename) => filename.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(filename));

const httpsUrlSchema = z
  .string()
  .url()
  .max(8_192)
  .refine((value) => new URL(value).protocol === 'https:', 'Attachment URL must use HTTPS');

export const externalMailAttachmentSchema = z
  .object({
    filename: attachmentFilenameSchema,
    contentType: z.string().trim().min(1).max(255).optional(),
    url: httpsUrlSchema,
    size: z.number().int().nonnegative().max(EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES).optional(),
  })
  .strict();

export const externalMailSubmissionInputSchema = z
  .object({
    externalUserId: externalUserIdSchema,
    connectionId: z.string().trim().min(1).max(255),
    replyToMessageId: z.string().trim().min(1).max(255).nullable().optional(),
    to: z.array(mailAddressSchema).min(1).max(500),
    cc: z.array(mailAddressSchema).max(500).default([]),
    bcc: z.array(mailAddressSchema).max(500).default([]),
    subject: z.string().max(998).default(''),
    textBody: z.string().max(1_000_000).default(''),
    htmlBody: z.string().max(1_000_000).default(''),
    attachments: z
      .array(externalMailAttachmentSchema)
      .max(EXTERNAL_MAIL_ATTACHMENT_MAX_COUNT)
      .default([]),
    sendAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const declaredAttachmentBytes = input.attachments.reduce(
      (total, attachment) => total + (attachment.size ?? 0),
      0,
    );
    if (declaredAttachmentBytes > EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['attachments'],
        message: `The declared attachment total exceeds ${EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_MIB} MiB`,
      });
    }
    if (
      input.textBody.length === 0 &&
      input.htmlBody.length === 0 &&
      input.attachments.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['textBody'],
        message: 'A body or attachment is required',
      });
    }
  });

export const externalMailIdempotencyKeySchema = z.string().trim().min(1).max(255);

export type ExternalMailAttachment = z.infer<typeof externalMailAttachmentSchema>;
export type ExternalMailSubmissionInput = z.infer<typeof externalMailSubmissionInputSchema>;

export type ExternalMailSubmissionPayload = Omit<
  ExternalMailSubmissionInput,
  'externalUserId' | 'connectionId'
>;

export type ExternalMailSubmissionPublicStatus =
  | 'accepted'
  | 'preparing'
  | 'scheduled'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'canceled';

export type ExternalMailSubmissionResponse = {
  id: string;
  externalUserId: string;
  connectionId: string;
  status: ExternalMailSubmissionPublicStatus;
  messageId: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  error: { code: string; message: string | null } | null;
};
