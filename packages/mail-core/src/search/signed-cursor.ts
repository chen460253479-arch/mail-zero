import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

import { MailCoreError } from '../types';

const invalidCursor = (): never => {
  throw new MailCoreError('INVALID_CURSOR');
};

const signature = (payload: string, signingKey: string): Buffer =>
  createHmac('sha256', signingKey).update(payload, 'utf8').digest();

export const encodeSignedCursor = (payload: unknown, signingKey: string): string => {
  if (signingKey.length < 16) throw new MailCoreError('STORAGE_FAILURE');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${signature(encodedPayload, signingKey).toString('base64url')}`;
};

export const decodeSignedCursor = (value: string, signingKey: string): unknown => {
  try {
    if (signingKey.length < 16) throw new MailCoreError('STORAGE_FAILURE');
    const [encodedPayload, encodedSignature, extra] = value.split('.');
    if (
      encodedPayload === undefined ||
      encodedSignature === undefined ||
      extra !== undefined ||
      !/^[A-Za-z0-9_-]+$/u.test(encodedPayload) ||
      !/^[A-Za-z0-9_-]+$/u.test(encodedSignature)
    ) {
      return invalidCursor();
    }
    const actual = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(encodedPayload, signingKey);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return invalidCursor();
    }
    const bytes = Buffer.from(encodedPayload, 'base64url');
    if (bytes.toString('base64url') !== encodedPayload) return invalidCursor();
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof MailCoreError) throw error;
    return invalidCursor();
  }
};
