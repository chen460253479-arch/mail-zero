import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverImapMessages,
  establishImapBaseline,
  fetchImapRawMessage,
} from '../../../../src/protocol-worker/imap/client';
import { createImapSmtpProtocolExecutor } from '../../../../src/mail-channel/imap-smtp/runtime/protocol-executor';
import { sendSmtpMessage, verifySmtpConnection } from '../../../../src/protocol-worker/smtp/client';
import { MailProtocolOperationError } from '../../../../src/protocol-worker/errors';

vi.mock('../../../../src/protocol-worker/imap/client', () => ({
  discoverImapMessages: vi.fn(),
  establishImapBaseline: vi.fn(),
  fetchImapRawMessage: vi.fn(),
}));

vi.mock('../../../../src/protocol-worker/smtp/client', () => ({
  sendSmtpMessage: vi.fn(),
  verifySmtpConnection: vi.fn(),
}));

const credential = {
  type: 'imap_smtp' as const,
  email: 'owner@example.test',
  username: 'imap-login',
  password: 'secret',
  imap: { host: 'imap.example.test', port: 993, secure: true },
  smtp: { host: 'smtp.example.test', port: 587, secure: false },
};

const baseline = {
  uidValidity: '42',
  uidNext: 8,
  highestModseq: '12',
};

const discovered = {
  ...baseline,
  scanUpperUid: 7,
  reset: false,
  messages: [
    {
      uid: 7,
      messageId: '<message-7@example.test>',
      receivedAt: '2026-07-29T00:00:00.000Z',
    },
  ],
  nextCursor: null,
};

const raw = {
  uidValidity: '42',
  uid: 7,
  rawMimeBase64: 'VGVzdA==',
  receivedAt: '2026-07-29T00:00:00.000Z',
};

const sent = {
  accepted: true as const,
  responseCode: 250,
  providerResponse: '250 accepted',
};

beforeEach(() => {
  vi.mocked(establishImapBaseline).mockReset().mockResolvedValue(baseline);
  vi.mocked(discoverImapMessages).mockReset().mockResolvedValue(discovered);
  vi.mocked(fetchImapRawMessage).mockReset().mockResolvedValue(raw);
  vi.mocked(verifySmtpConnection).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendSmtpMessage).mockReset().mockResolvedValue(sent);
});

describe('ImapSmtpProtocolExecutor', () => {
  it('parses and forwards every real protocol request without using HTTP', async () => {
    const requestFetch = vi.spyOn(globalThis, 'fetch');
    const executor = createImapSmtpProtocolExecutor({
      allowedHosts: 'imap.example.test,smtp.example.test',
    });
    const discoverRequest = {
      credential,
      mailbox: 'INBOX' as const,
      expectedUidValidity: '42',
      nextUid: 7,
      lastSuccessfulAt: '2026-07-28T00:00:00.000Z',
      cursor: null,
      limit: 100,
    };

    await expect(executor.verify({ credential })).resolves.toEqual({
      email: 'owner@example.test',
    });
    await expect(executor.establishBaseline({ credential, mailbox: 'INBOX' })).resolves.toEqual(
      baseline,
    );
    await expect(executor.discover(discoverRequest)).resolves.toEqual(discovered);
    await expect(
      executor.fetchRaw({
        credential,
        mailbox: 'INBOX',
        uidValidity: '42',
        uid: 7,
      }),
    ).resolves.toEqual(raw);
    await expect(
      executor.send({
        credential,
        envelope: { from: 'owner@example.test', to: ['recipient@example.test'] },
        rawMimeBase64: 'VGVzdA==',
        messageId: '<message-7@example.test>',
      }),
    ).resolves.toEqual(sent);

    expect(establishImapBaseline).toHaveBeenNthCalledWith(
      1,
      { credential, mailbox: 'INBOX' },
      'imap.example.test,smtp.example.test',
    );
    expect(establishImapBaseline).toHaveBeenNthCalledWith(
      2,
      { credential, mailbox: 'INBOX' },
      'imap.example.test,smtp.example.test',
    );
    expect(discoverImapMessages).toHaveBeenCalledWith(
      discoverRequest,
      'imap.example.test,smtp.example.test',
    );
    expect(fetchImapRawMessage).toHaveBeenCalledWith(
      {
        credential,
        mailbox: 'INBOX',
        uidValidity: '42',
        uid: 7,
      },
      'imap.example.test,smtp.example.test',
    );
    expect(verifySmtpConnection).toHaveBeenCalledWith(
      credential,
      'imap.example.test,smtp.example.test',
    );
    expect(sendSmtpMessage).toHaveBeenCalledWith(
      {
        credential,
        envelope: { from: 'owner@example.test', to: ['recipient@example.test'] },
        rawMimeBase64: 'VGVzdA==',
        messageId: '<message-7@example.test>',
      },
      'imap.example.test,smtp.example.test',
    );
    expect(requestFetch).not.toHaveBeenCalled();
    requestFetch.mockRestore();
  });

  it('rejects incomplete or extended request objects with a safe permanent error', async () => {
    const executor = createImapSmtpProtocolExecutor({});

    await expect(
      executor.establishBaseline({
        credential,
        mailbox: 'INBOX',
        unexpected: true,
      } as never),
    ).rejects.toMatchObject({
      code: 'MAIL_PROTOCOL_INVALID_REQUEST',
      classification: 'permanent',
    });
    expect(establishImapBaseline).not.toHaveBeenCalled();
  });

  it.each([
    [
      'authentication',
      () => {
        vi.mocked(establishImapBaseline).mockRejectedValueOnce(
          new MailProtocolOperationError('IMAP_AUTHENTICATION_FAILED', 'authentication'),
        );
        return createImapSmtpProtocolExecutor({}).establishBaseline({
          credential,
          mailbox: 'INBOX',
        });
      },
      'IMAP_AUTHENTICATION_FAILED',
    ],
    [
      'retryable',
      () => {
        vi.mocked(discoverImapMessages).mockRejectedValueOnce(
          new MailProtocolOperationError('IMAP_OPERATION_FAILED', 'retryable'),
        );
        return createImapSmtpProtocolExecutor({}).discover({
          credential,
          mailbox: 'INBOX',
          expectedUidValidity: '42',
          nextUid: 7,
          lastSuccessfulAt: '2026-07-28T00:00:00.000Z',
          cursor: null,
          limit: 100,
        });
      },
      'IMAP_OPERATION_FAILED',
    ],
    [
      'permanent',
      () => {
        vi.mocked(fetchImapRawMessage).mockRejectedValueOnce(
          new MailProtocolOperationError('IMAP_MESSAGE_NOT_FOUND', 'permanent'),
        );
        return createImapSmtpProtocolExecutor({}).fetchRaw({
          credential,
          mailbox: 'INBOX',
          uidValidity: '42',
          uid: 7,
        });
      },
      'IMAP_MESSAGE_NOT_FOUND',
    ],
    [
      'uncertain',
      () => {
        vi.mocked(sendSmtpMessage).mockRejectedValueOnce(
          new MailProtocolOperationError('SMTP_RESULT_UNKNOWN', 'uncertain'),
        );
        return createImapSmtpProtocolExecutor({}).send({
          credential,
          envelope: { from: 'owner@example.test', to: ['recipient@example.test'] },
          rawMimeBase64: 'VGVzdA==',
          messageId: '<message-7@example.test>',
        });
      },
      'SMTP_RESULT_UNKNOWN',
    ],
  ] as const)('preserves %s protocol error classification', async (classification, run, code) => {
    await expect(run()).rejects.toMatchObject({ code, classification });
  });
});
