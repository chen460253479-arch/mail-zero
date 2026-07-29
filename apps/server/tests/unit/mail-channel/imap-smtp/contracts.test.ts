import { describe, expect, it } from 'vitest';

import {
  parseImapBaselineRequest,
  parseImapDiscoverResponse,
  parseSmtpSendRequest,
} from '../../../../src/mail-channel/imap-smtp/shared/contracts';

const credential = {
  type: 'imap_smtp' as const,
  email: 'user@example.test',
  username: 'user@example.test',
  password: 'secret',
  imap: { host: 'imap.example.test', port: 993, secure: true },
  smtp: { host: 'smtp.example.test', port: 587, secure: false },
};

describe('IMAP/SMTP protocol contracts', () => {
  it('accepts a bounded IMAP baseline request and rejects unsupported mailboxes', () => {
    expect(parseImapBaselineRequest({ credential, mailbox: 'INBOX' })).toEqual({
      credential,
      mailbox: 'INBOX',
    });
    expect(() => parseImapBaselineRequest({ credential, mailbox: 'Archive' })).toThrow();
  });

  it('requires a stable UID page with an explicit scan boundary', () => {
    expect(
      parseImapDiscoverResponse({
        uidValidity: '123',
        uidNext: 205,
        highestModseq: '900',
        scanUpperUid: 204,
        reset: false,
        messages: [
          {
            uid: 200,
            messageId: '<message@example.test>',
            receivedAt: '2026-07-28T12:00:00.000Z',
          },
        ],
        nextCursor: {
          mode: 'uid',
          uidValidity: '123',
          nextUid: 201,
          upperUid: 204,
        },
      }),
    ).toMatchObject({ uidValidity: '123', scanUpperUid: 204 });
    expect(() =>
      parseImapDiscoverResponse({
        uidValidity: '123',
        uidNext: 205,
        highestModseq: null,
        scanUpperUid: 204,
        reset: false,
        messages: [],
        nextCursor: {
          mode: 'uid',
          uidValidity: '123',
          nextUid: 205,
          upperUid: 204,
        },
      }),
    ).toThrow();
  });

  it('bounds SMTP MIME payloads and preserves the frozen envelope', () => {
    expect(
      parseSmtpSendRequest({
        credential,
        envelope: {
          from: 'user@example.test',
          to: ['recipient@example.test'],
        },
        rawMimeBase64: 'AQID',
        messageId: '<message@example.test>',
      }),
    ).toMatchObject({
      rawMimeBase64: 'AQID',
      messageId: '<message@example.test>',
    });
    expect(() =>
      parseSmtpSendRequest({
        credential,
        envelope: { from: '', to: [] },
        rawMimeBase64: '',
        messageId: 'invalid',
      }),
    ).toThrow();
  });
});
