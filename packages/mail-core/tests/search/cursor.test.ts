import { describe, expect, it } from 'vitest';

import {
  decodeCursor,
  encodeCursor,
  MailCoreError,
  type EmailCursorPayload,
  type EmailId,
  type MailAccountId,
  type ThreadCursorPayload,
  type ThreadId,
} from '../../src';

const accountOne = 'account-1' as MailAccountId;
const accountTwo = 'account-2' as MailAccountId;

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

    expect(decodeCursor(encodeCursor(payload), accountOne)).toEqual(payload);
  });

  it('uses canonical unpadded base64url encoding', () => {
    const encoded = encodeCursor(emailCursor());

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
    expect(encodeCursor(decodeCursor(encoded, accountOne))).toBe(encoded);
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
      decodeCursor(encoded, accountOne);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MailCoreError);
    expect(error).toMatchObject({ code: 'INVALID_CURSOR', details: {} });
  });

  it('rejects a valid cursor from another account with a safe stable error', () => {
    expect(() =>
      decodeCursor(encodeCursor(emailCursor({ accountId: accountTwo })), accountOne),
    ).toThrowError(expect.objectContaining({ code: 'CROSS_ACCOUNT_REFERENCE', details: {} }));
  });

  it('rejects unsupported versions', () => {
    const encoded = Buffer.from(JSON.stringify({ ...emailCursor(), version: 2 })).toString(
      'base64url',
    );

    expect(() => decodeCursor(encoded, accountOne)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CURSOR', details: {} }),
    );
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

    expect(decodeCursor(encodeCursor(payload), accountOne)).toEqual(payload);
  });
});
