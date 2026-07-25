import { Buffer } from 'node:buffer';
import { z } from 'zod';

import { MailCoreError, type MailAccountId } from '../types';
import type { CursorPayload } from './types';

const safeId = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const canonicalBigInt = z.string().regex(/^(0|-?[1-9][0-9]*)$/);
const isoDate = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
});

const cursorValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('date'), value: isoDate }).strict(),
  z.object({ type: z.literal('null') }).strict(),
  z.object({ type: z.literal('bigint'), value: canonicalBigInt }).strict(),
  z.object({ type: z.literal('string'), value: z.string() }).strict(),
]);

const emailCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('email'),
    accountId: safeId,
    sort: z.enum(['receivedAt', 'sentAt', 'size', 'subject']),
    direction: z.enum(['asc', 'desc']),
    query: z.string().min(1),
    value: cursorValueSchema,
    emailId: safeId,
  })
  .strict();

const threadCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('thread'),
    accountId: safeId,
    query: z.string().min(1),
    latestReceivedAt: isoDate,
    threadId: safeId,
  })
  .strict();

const cursorSchema = z.discriminatedUnion('kind', [emailCursorSchema, threadCursorSchema]);

const invalidCursor = (): never => {
  throw new MailCoreError('INVALID_CURSOR');
};

const canonicalJson = (payload: CursorPayload): string => {
  if (payload.kind === 'email') {
    return JSON.stringify({
      version: payload.version,
      kind: payload.kind,
      accountId: payload.accountId,
      sort: payload.sort,
      direction: payload.direction,
      query: payload.query,
      value: payload.value,
      emailId: payload.emailId,
    });
  }
  return JSON.stringify({
    version: payload.version,
    kind: payload.kind,
    accountId: payload.accountId,
    query: payload.query,
    latestReceivedAt: payload.latestReceivedAt,
    threadId: payload.threadId,
  });
};

export function encodeCursor(payload: CursorPayload): string {
  const parsed = cursorSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidCursor();
  }
  return Buffer.from(canonicalJson(parsed.data as CursorPayload), 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string, accountId: MailAccountId): CursorPayload {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
      return invalidCursor();
    }
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) {
      return invalidCursor();
    }
    const parsedJson: unknown = JSON.parse(bytes.toString('utf8'));
    const parsed = cursorSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return invalidCursor();
    }
    const payload = parsed.data as CursorPayload;
    if (payload.accountId !== accountId) {
      throw new MailCoreError('CROSS_ACCOUNT_REFERENCE');
    }
    return payload;
  } catch (error) {
    if (error instanceof MailCoreError) {
      throw error;
    }
    return invalidCursor();
  }
}
