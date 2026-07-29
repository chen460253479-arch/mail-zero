import { describe, expect, it, vi } from 'vitest';

import type { MailProtocolClient } from '../../../../../src/mail-channel/imap-smtp/shared/protocol-client';
import { MailProtocolClientError } from '../../../../../src/mail-channel/imap-smtp/shared/protocol-client';
import { createImapSmtpIngressAdapter } from '../../../../../src/mail-channel/imap-smtp/inbound/adapter';
import { parseIngressScope } from '../../../../../src/modules/mail-sync';

const createClient = (overrides: Partial<MailProtocolClient> = {}): MailProtocolClient => ({
  verify: vi.fn(),
  establishImapBaseline: vi.fn(async () => ({
    uidValidity: '123',
    uidNext: 200,
    highestModseq: '900',
  })),
  discoverImap: vi.fn(),
  fetchImapRaw: vi.fn(),
  sendSmtp: vi.fn(),
  ...overrides,
});

const checkpoint = {
  version: 1,
  mailbox: 'INBOX',
  uidValidity: '123',
  nextUid: 200,
  highestModseq: '900',
  lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
};

describe('IMAP/SMTP inbound adapter', () => {
  it('establishes a no-history UID baseline without fetching old messages', async () => {
    const client = createClient();
    const adapter = createImapSmtpIngressAdapter(client, {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(adapter.establishCheckpoint(parseIngressScope())).resolves.toEqual(checkpoint);
    expect(client.establishImapBaseline).toHaveBeenCalledOnce();
    expect(client.discoverImap).not.toHaveBeenCalled();
  });

  it('maps a bounded UID page and advances only after the final page', async () => {
    const discoverImap = vi.fn(async () => ({
      uidValidity: '123',
      uidNext: 202,
      highestModseq: '901',
      scanUpperUid: 201,
      reset: false,
      messages: [
        {
          uid: 200,
          messageId: '<message@example.test>',
          receivedAt: '2026-07-28T12:01:00.000Z',
        },
      ],
      nextCursor: null,
    }));
    const adapter = createImapSmtpIngressAdapter(createClient({ discoverImap }), {
      now: () => new Date('2026-07-28T12:02:00.000Z'),
    });

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint,
        pageToken: null,
      }),
    ).resolves.toEqual({
      events: [
        {
          type: 'message_added',
          remoteMessageId: '123:200',
          remoteThreadId: null,
        },
      ],
      checkpoint: {
        ...checkpoint,
        nextUid: 202,
        highestModseq: '901',
        lastSuccessfulAt: '2026-07-28T12:02:00.000Z',
      },
      nextPageToken: null,
    });
    expect(discoverImap).toHaveBeenCalledWith({
      expectedUidValidity: '123',
      nextUid: 200,
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
      cursor: null,
      limit: 100,
    });
  });

  it('fetches exact RFC 822 bytes by UIDVALIDITY-qualified remote ID', async () => {
    const client = createClient({
      fetchImapRaw: vi.fn(async () => ({
        uidValidity: '123',
        uid: 200,
        rawMimeBase64: 'AQID',
        receivedAt: '2026-07-28T12:01:00.000Z',
      })),
    });
    const adapter = createImapSmtpIngressAdapter(client);

    await expect(
      adapter.fetchRawMessage({
        scope: parseIngressScope(),
        remoteMessageId: '123:200',
      }),
    ).resolves.toEqual({
      remoteMessageId: '123:200',
      raw: new Uint8Array([1, 2, 3]),
      receivedAt: new Date('2026-07-28T12:01:00.000Z'),
    });
  });

  it('preserves protocol Worker failure classifications', () => {
    const adapter = createImapSmtpIngressAdapter(createClient());
    expect(
      adapter.classifyError(
        new MailProtocolClientError('IMAP_AUTHENTICATION_FAILED', 'authentication'),
      ),
    ).toBe('authentication');
    expect(adapter.classifyError(new Error('unknown'))).toBe('retryable');
  });
});
