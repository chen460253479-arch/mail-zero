import { z } from 'zod';

import { decodeSignedCursor, encodeSignedCursor } from './signed-cursor';
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

export function encodeCursor(payload: CursorPayload, signingKey: string): string {
  const parsed = cursorSchema.safeParse(payload);
  if (!parsed.success) {
    return invalidCursor();
  }
  return encodeSignedCursor(JSON.parse(canonicalJson(parsed.data as CursorPayload)), signingKey);
}

export function decodeCursor(
  encoded: string,
  accountId: MailAccountId,
  signingKey: string,
): CursorPayload {
  try {
    const parsedJson = decodeSignedCursor(encoded, signingKey);
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
