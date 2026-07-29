import { describe, expect, it, vi } from 'vitest';

import {
  MailProtocolWorkerError,
  type MailProtocolClient,
} from '../../../../../src/mail-channel/imap-smtp/shared/protocol-client';
import { createImapSmtpOutboundAdapter } from '../../../../../src/mail-channel/imap-smtp/outbound/adapter';
import type { FrozenOutboundMessage } from '../../../../../src/mail-channel/contracts';

const message: FrozenOutboundMessage = {
  accountId: 'account-1',
  connectionId: 'connection-1',
  submissionId: 'submission-1',
  deliveryId: 'delivery-1',
  envelope: {
    from: 'sender@example.test',
    to: ['to@example.test'],
    cc: ['cc@example.test'],
    bcc: ['bcc@example.test'],
  },
  rawMime: new Uint8Array([1, 2, 3]),
  messageId: '<stable@example.test>',
  remoteThreadId: null,
};

const createClient = (overrides: Partial<MailProtocolClient> = {}): MailProtocolClient => ({
  verify: vi.fn(),
  establishImapBaseline: vi.fn(),
  discoverImap: vi.fn(),
  fetchImapRaw: vi.fn(),
  sendSmtp: vi.fn(),
  ...overrides,
});

describe('IMAP/SMTP outbound adapter', () => {
  it('sends the frozen MIME and envelope and accepts only a final SMTP 2xx result', async () => {
    const sendSmtp = vi.fn(async () => ({
      accepted: true as const,
      responseCode: 250,
      providerResponse: '250 2.0.0 queued',
    }));
    const adapter = createImapSmtpOutboundAdapter(createClient({ sendSmtp }), {
      now: () => new Date('2026-07-28T12:00:05.000Z'),
    });

    await expect(adapter.send(message)).resolves.toEqual({
      remoteMessageId: '<stable@example.test>',
      remoteThreadId: null,
      acceptedAt: new Date('2026-07-28T12:00:05.000Z'),
      providerCode: '250',
      safeResponse: 'accepted',
    });
    expect(sendSmtp).toHaveBeenCalledWith({
      envelope: {
        from: 'sender@example.test',
        to: ['to@example.test', 'cc@example.test', 'bcc@example.test'],
      },
      rawMimeBase64: 'AQID',
      messageId: '<stable@example.test>',
    });
  });

  it('maps authentication, retryable, and post-DATA uncertainty without blind resend', async () => {
    const adapter = createImapSmtpOutboundAdapter(createClient(), {
      now: () => new Date('2026-07-28T12:00:05.000Z'),
    });

    expect(
      adapter.classifyError(
        new MailProtocolWorkerError('SMTP_AUTHENTICATION_FAILED', 'authentication'),
      ),
    ).toMatchObject({ kind: 'authentication_required' });
    expect(
      adapter.classifyError(new MailProtocolWorkerError('SMTP_TEMPORARY_FAILURE', 'retryable')),
    ).toMatchObject({ kind: 'temporary_failure' });
    expect(
      adapter.classifyError(new MailProtocolWorkerError('SMTP_RESULT_UNKNOWN', 'uncertain')),
    ).toMatchObject({ kind: 'uncertain', safeResponse: 'unknown_result' });
    await expect(
      adapter.reconcile?.({
        accountId: 'account-1',
        connectionId: 'connection-1',
        submissionId: 'submission-1',
        deliveryId: 'delivery-1',
        messageId: '<stable@example.test>',
        remoteThreadId: null,
      }),
    ).resolves.toEqual({
      status: 'inconclusive',
      retryAfter: new Date('2026-07-28T12:05:05.000Z'),
    });
  });
});
