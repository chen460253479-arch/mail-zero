import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendSmtpMessage } from '../../../../src/mail-channel/imap-smtp/runtime/smtp/client';
import { resolveMailEndpoint } from '../../../../src/mail-channel/imap-smtp/runtime/network';

const transportMocks = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: transportMocks.createTransport },
}));

vi.mock('../../../../src/mail-channel/imap-smtp/runtime/network', () => ({
  resolveMailEndpoint: vi.fn(),
}));

const credential = {
  type: 'imap_smtp' as const,
  email: 'owner@example.test',
  username: 'owner@example.test',
  password: 'secret',
  imap: { host: 'imap.example.test', port: 993, secure: true },
  smtp: { host: 'smtp.example.test', port: 465, secure: true },
};

const rawMime = Buffer.from(
  'Message-ID: <diagnostic@example.test>\r\nFrom: owner@example.test\r\n\r\nbody',
).toString('base64');

beforeEach(() => {
  transportMocks.close.mockReset();
  transportMocks.createTransport.mockReset();
  transportMocks.sendMail.mockReset();
  transportMocks.verify.mockReset();
  vi.mocked(resolveMailEndpoint)
    .mockReset()
    .mockResolvedValue({
      ...credential.smtp,
      originalHost: credential.smtp.host,
      address: '203.0.113.10',
    });
  transportMocks.createTransport.mockReturnValue({
    close: transportMocks.close,
    sendMail: transportMocks.sendMail,
    verify: transportMocks.verify,
  });
});

describe('SMTP client', () => {
  it('uses the extended socket timeout without enabling protocol diagnostics', async () => {
    transportMocks.sendMail.mockResolvedValue({
      accepted: ['recipient@example.test'],
      rejected: [],
      response: '250 2.0.0 accepted',
    });

    await expect(
      sendSmtpMessage(
        {
          credential,
          envelope: { from: 'owner@example.test', to: ['recipient@example.test'] },
          rawMimeBase64: rawMime,
          messageId: '<diagnostic@example.test>',
        },
        'smtp.example.test',
      ),
    ).resolves.toEqual({
      accepted: true,
      responseCode: 250,
      providerResponse: '250 2.0.0 accepted',
    });

    expect(transportMocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 300_000,
      }),
    );
    const transportOptions = transportMocks.createTransport.mock.calls[0]?.[0];
    expect(transportOptions).not.toHaveProperty('logger');
    expect(transportOptions).not.toHaveProperty('transactionLog');
    expect(transportMocks.close).toHaveBeenCalledOnce();
  });
});
