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

describe('SMTP client diagnostics', () => {
  it('logs the exact SMTP phase, last command, response, and raw provider error', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    transportMocks.sendMail.mockImplementation(async () => {
      const options = transportMocks.createTransport.mock.calls[0]?.[0] as {
        logger: {
          debug(entry: Record<string, unknown>, message: string, ...args: unknown[]): void;
          info(entry: Record<string, unknown>, message: string, ...args: unknown[]): void;
          warn(entry: Record<string, unknown>, message: string, ...args: unknown[]): void;
        };
      };
      const protocol = options.logger;
      protocol.info(
        {
          component: 'smtp-connection',
          sid: 'smtp-session-1',
          tnx: 'network',
          remoteAddress: '203.0.113.10',
          remotePort: 465,
        },
        'Secure connection established',
      );
      protocol.debug({ component: 'smtp-connection', tnx: 'server' }, '220 ready');
      protocol.debug({ component: 'smtp-connection', tnx: 'client' }, 'EHLO zero.test');
      protocol.debug({ component: 'smtp-connection', tnx: 'server' }, '250 AUTH LOGIN');
      protocol.info(
        { component: 'smtp-connection', tnx: 'smtp', action: 'authenticated' },
        'authenticated',
      );
      protocol.debug(
        { component: 'smtp-connection', tnx: 'client' },
        'MAIL FROM:<owner@example.test>',
      );
      protocol.debug({ component: 'smtp-connection', tnx: 'server' }, '250 sender accepted');
      protocol.debug(
        { component: 'smtp-connection', tnx: 'client' },
        'RCPT TO:<recipient@example.test>',
      );
      protocol.debug({ component: 'smtp-connection', tnx: 'server' }, '250 recipient accepted');
      protocol.debug({ component: 'smtp-connection', tnx: 'client' }, 'DATA');
      protocol.debug({ component: 'smtp-connection', tnx: 'server' }, '354 send message');
      protocol.info(
        {
          component: 'smtp-connection',
          tnx: 'message',
          inByteCount: 14_087_341,
          outByteCount: 14_087_346,
        },
        '<%s bytes encoded mime message>',
        14_087_346,
      );
      protocol.warn({ component: 'smtp-connection' }, 'Timeout');

      throw Object.assign(new Error('Timeout'), {
        code: 'ETIMEDOUT',
        command: 'CONN',
      });
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
        logger,
      ),
    ).rejects.toMatchObject({
      code: 'SMTP_TEMPORARY_FAILURE',
      classification: 'retryable',
    });

    expect(transportMocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 300_000,
        transactionLog: true,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'mail.smtp.protocol_trace',
      expect.objectContaining({
        smtpPhase: 'awaiting_provider_response',
        smtpTransaction: 'message',
        protocolMessage: '<14087346 bytes encoded mime message>',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'mail.smtp.send_failed',
      expect.objectContaining({
        smtpPhase: 'awaiting_provider_response',
        lastClientCommand: 'DATA',
        lastServerResponse: '354 send message',
        errorName: 'Error',
        errorCode: 'ETIMEDOUT',
        errorMessage: 'Timeout',
        smtpCommand: 'CONN',
        smtpResponseCode: null,
        smtpResponse: null,
        classification: 'retryable',
        providerCode: 'SMTP_TEMPORARY_FAILURE',
      }),
    );
    expect(transportMocks.close).toHaveBeenCalledOnce();
  });
});
