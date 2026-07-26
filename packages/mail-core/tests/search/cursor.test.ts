import { describe, expect, it } from 'vitest';

import {
  decodeCursor,
  encodeCursor,
  encodeSignedCursor,
  MailCoreError,
  type EmailCursorPayload,
  type EmailId,
  type MailAccountId,
  type ThreadCursorPayload,
  type ThreadId,
} from '../../src';

const accountOne = 'account-1' as MailAccountId;
const accountTwo = 'account-2' as MailAccountId;
const signingKey = 'cursor-test-signing-key';

const emailCursor = (overrides: Partial<EmailCursorPayload> = {}): EmailCursorPayload => ({
  version: 1,
  kind: 'email',
  accountId: accountOne,
  sort: 'receivedAt',
  direction: 'desc',
  query: 'query-signature',
  value: { type: 'date', value: '2026-01-02T03:04:05.006Z' },
  emailId: 'email-1' as EmailId,
  ...overrides,
});

describe('search cursors', () => {
  it.each([
    ['date', { type: 'date', value: '2026-01-02T03:04:05.006Z' } as const],
    ['nullable date', { type: 'null' } as const],
    ['bigint', { type: 'bigint', value: '900719925474099312345' } as const],
    ['subject', { type: 'string', value: 're: release' } as const],
  ])('losslessly round-trips an Email %s sort value', (_label, value) => {
    const payload = emailCursor({ value });

    expect(decodeCursor(encodeCursor(payload, signingKey), accountOne, signingKey)).toEqual(
      payload,
    );
  });

  it('uses canonical unpadded base64url encoding', () => {
    const encoded = encodeCursor(emailCursor(), signingKey);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
    expect(encodeCursor(decodeCursor(encoded, accountOne, signingKey), signingKey)).toBe(encoded);
  });

  it.each([
    'not-base64url!',
    Buffer.from('{}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        ...emailCursor(),
        extra: true,
      }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        ...emailCursor(),
        value: { type: 'bigint', value: '01' },
      }),
    ).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        ...emailCursor(),
        emailId: '',
      }),
    ).toString('base64url'),
  ])('rejects malformed payload %s without leaking parser details', (encoded) => {
    let error: unknown;
    try {
      decodeCursor(encoded, accountOne, signingKey);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MailCoreError);
    expect(error).toMatchObject({ code: 'INVALID_CURSOR', details: {} });
  });

  it('rejects a valid cursor from another account with a safe stable error', () => {
    expect(() =>
      decodeCursor(
        encodeCursor(emailCursor({ accountId: accountTwo }), signingKey),
        accountOne,
        signingKey,
      ),
    ).toThrowError(expect.objectContaining({ code: 'CROSS_ACCOUNT_REFERENCE', details: {} }));
  });

  it('rejects unsupported versions', () => {
    const encoded = encodeSignedCursor({ ...emailCursor(), version: 2 }, signingKey);

    expect(() => decodeCursor(encoded, accountOne, signingKey)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CURSOR', details: {} }),
    );
  });

  it('rejects a valid signed cursor after either payload or signature tampering', () => {
    const encoded = encodeCursor(emailCursor(), signingKey);
    const [payload, signature] = encoded.split('.');
    const replaceLast = (value: string) =>
      `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`;

    expect(() =>
      decodeCursor(`${replaceLast(payload!)}.${signature}`, accountOne, signingKey),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR', details: {} }));
    expect(() =>
      decodeCursor(`${payload}.${replaceLast(signature!)}`, accountOne, signingKey),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR', details: {} }));
  });

  it('keeps Thread cursors independently typed and encoded', () => {
    const payload: ThreadCursorPayload = {
      version: 1,
      kind: 'thread',
      accountId: accountOne,
      query: 'thread-query-signature',
      latestReceivedAt: '2026-01-02T03:04:05.006Z',
      threadId: 'thread-1' as ThreadId,
    };

    expect(decodeCursor(encodeCursor(payload, signingKey), accountOne, signingKey)).toEqual(
      payload,
    );
  });
});
