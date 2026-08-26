import { describe, expect, it, vi } from 'vitest';

import type { ClaimedDelivery } from '../../../../../src/modules/mail-outbound/domain/delivery';
import { deliverClaimed } from '../../../../../src/modules/mail-outbound/application/deliver';

const claimed = {
  delivery: {
    id: 'delivery-1',
    mailAccountId: 'account-1',
    submissionId: 'submission-1',
    connectionId: 'connection-1',
    status: 'leased',
    availableAt: new Date('2026-01-01T00:00:00.000Z'),
    leaseOwner: 'worker-1',
    leaseToken: 'lease-1',
    leaseExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
    attemptCount: 1,
    reconciliationCount: 0,
    uncertainSince: null,
    lastErrorKind: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: null,
  },
  attemptKind: 'send',
  attemptNumber: 1,
} satisfies ClaimedDelivery;

const createHarness = (
  send: () => Promise<{
    remoteMessageId: string;
    remoteThreadId: string | null;
    acceptedAt: Date;
    providerCode: string | null;
    safeResponse: 'accepted';
  }>,
) => {
  const raw = new Uint8Array([0, 1, 2, 253, 254, 255]);
  let transactionActive = false;
  const events: string[] = [];
  const outbound = {
    loadMessage: vi.fn(async () => ({
      delivery: claimed.delivery,
      channelId: 'outlook',
      envelope: {
        from: 'sender@example.test',
        to: ['recipient@example.test'],
        cc: [],
        bcc: [],
      },
      messageId: '<stable-message@example.test>',
      raw: {
        blobId: 'blob-1',
        objectKey: 'mail/account-1/raw',
        sha256: 'sha',
        sizeBytes: BigInt(raw.length),
        contentType: 'message/rfc822',
      },
      remoteThreadReferences: [{ provider: 'outlook', remoteThreadId: 'outlook-thread' }],
    })),
    scheduleRetry: vi.fn(),
    markUncertain: vi.fn(),
  };
  const adapter = {
    provider: 'outlook',
    send: vi.fn(async (message) => {
      expect(transactionActive).toBe(false);
      expect(message.rawMime).toEqual(raw);
      expect(message.remoteThreadId).toBe('outlook-thread');
      events.push('send');
      return send();
    }),
    classifyError: vi.fn(() => ({
      kind: 'temporary_failure' as const,
      providerCode: 'TEMP',
      safeResponse: 'temporary_failure' as const,
      retryAfter: null,
    })),
  };
  const dependencies = {
    unitOfWork: {
      run: async <Result>(
        operation: (tx: { outbound: typeof outbound }) => Promise<Result>,
      ): Promise<Result> => {
        transactionActive = true;
        try {
          return await operation({ outbound });
        } finally {
          transactionActive = false;
        }
      },
    },
    blobStore: {
      get: vi.fn(async () => raw),
    },
    credentialResolver: {
      resolve: vi.fn(async () => {
        events.push('credential');
        return {
          type: 'oauth2' as const,
          accessToken: 'token',
          expiresAt: null,
        };
      }),
    },
    registry: {
      getOutbound: vi.fn(() => ({
        createAdapter: vi.fn(async () => {
          events.push('adapter');
          return adapter;
        }),
      })),
    },
    connectionState: {
      markAuthenticationRequired: vi.fn(),
    },
    clock: { now: () => new Date('2026-01-01T00:00:10.000Z') },
    jitter: () => 0,
    logger: { error: vi.fn() },
    finalizeAccepted: vi.fn(),
    finalizeFailed: vi.fn(),
  };
  return { adapter, dependencies, events, outbound, raw };
};

describe('provider-neutral outbound delivery', () => {
  it('routes exact frozen bytes outside transactions and finalizes accepted results', async () => {
    const accepted = {
      remoteMessageId: 'remote-message-1',
      remoteThreadId: 'remote-thread-1',
      acceptedAt: new Date('2026-01-01T00:00:05.000Z'),
      providerCode: '202',
      safeResponse: 'accepted' as const,
    };
    const h = createHarness(async () => accepted);

    await expect(deliverClaimed(claimed, h.dependencies as never)).resolves.toBe('sent');
    expect(h.events).toEqual(['credential', 'adapter', 'send']);
    expect(h.dependencies.registry.getOutbound).toHaveBeenCalledWith('outlook');
    expect(h.dependencies.finalizeAccepted).toHaveBeenCalledWith({
      claimed,
      provider: 'outlook',
      accepted,
    });
  });

  it.each([
    ['temporary_failure', 'retry_wait'],
    ['authentication_required', 'retry_wait'],
    ['uncertain', 'uncertain'],
    ['policy_rejected', 'failed'],
  ] as const)('maps %s without leaking provider logic into routing', async (kind, expected) => {
    const h = createHarness(async () => {
      throw new Error('provider secret');
    });
    h.adapter.classifyError.mockReturnValue({
      kind,
      providerCode: 'SAFE_CODE',
      safeResponse: kind === 'uncertain' ? 'unknown_result' : kind,
      retryAfter: null,
    } as never);

    await expect(deliverClaimed(claimed, h.dependencies as never)).resolves.toBe(expected);
    expect(h.dependencies.logger.error).toHaveBeenCalledWith(
      'mail.outbound.delivery_failed',
      expect.objectContaining({
        provider: 'outlook',
        accountId: 'account-1',
        connectionId: 'connection-1',
        submissionId: 'submission-1',
        deliveryId: 'delivery-1',
        attemptKind: 'send',
        attemptNumber: 1,
        outcome: expected,
        classification: kind,
        providerCode: 'SAFE_CODE',
        errorMessage: 'provider secret',
      }),
    );
    if (kind === 'temporary_failure' || kind === 'authentication_required') {
      expect(h.outbound.scheduleRetry).toHaveBeenCalledOnce();
    }
    if (kind === 'authentication_required') {
      expect(h.dependencies.connectionState.markAuthenticationRequired).toHaveBeenCalledWith(
        'connection-1',
      );
    }
    if (kind === 'uncertain') {
      expect(h.outbound.markUncertain).toHaveBeenCalledOnce();
    }
    if (kind === 'policy_rejected') {
      expect(h.dependencies.finalizeFailed).toHaveBeenCalledOnce();
    }
  });
});
