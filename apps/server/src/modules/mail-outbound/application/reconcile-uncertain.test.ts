import { describe, expect, it, vi } from 'vitest';

import { reconcileUncertainDelivery } from './reconcile-uncertain';
import type { ClaimedDelivery } from '../domain/delivery';

const claimed = (reconciliationCount: number): ClaimedDelivery => ({
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
    reconciliationCount,
    uncertainSince: new Date('2026-01-01T00:00:00.000Z'),
    lastErrorKind: 'uncertain',
    lastErrorCode: null,
    lastErrorMessage: 'unknown_result',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: null,
  },
  attemptKind: 'reconcile',
  attemptNumber: 1 + reconciliationCount,
});

const createHarness = (
  reconciliationCount: number,
  reconcile:
    | undefined
    | (() => Promise<
        | {
            status: 'found';
            result: {
              remoteMessageId: string;
              remoteThreadId: string | null;
              acceptedAt: Date;
              providerCode: string | null;
              safeResponse: 'accepted';
            };
          }
        | { status: 'not_found' }
        | { status: 'inconclusive'; retryAfter: Date | null }
      >),
) => {
  const current = claimed(reconciliationCount);
  const outbound = {
    claimById: vi.fn(async () => current),
    loadMessage: vi.fn(async () => ({
      delivery: current.delivery,
      channelId: 'gmail',
      envelope: {
        from: 'sender@example.test',
        to: ['recipient@example.test'],
        cc: [],
        bcc: [],
      },
      messageId: '<stable@example.test>',
      raw: {
        blobId: 'blob-1',
        objectKey: 'mail/raw',
        sha256: 'sha',
        sizeBytes: 10n,
        contentType: 'message/rfc822',
      },
      remoteThreadReferences: [],
    })),
    scheduleReconciliation: vi.fn(),
    scheduleResend: vi.fn(),
  };
  const send = vi.fn();
  const adapter = {
    provider: 'gmail',
    send,
    classifyError: vi.fn(),
    ...(reconcile === undefined ? {} : { reconcile }),
  };
  const dependencies = {
    unitOfWork: {
      run: async <Result>(
        operation: (tx: { outbound: typeof outbound }) => Promise<Result>,
      ): Promise<Result> => operation({ outbound }),
    },
    credentialResolver: {
      resolve: vi.fn(async () => ({
        type: 'oauth2' as const,
        accessToken: 'token',
        expiresAt: null,
      })),
    },
    registry: {
      getOutbound: vi.fn(() => ({
        createAdapter: vi.fn(async () => adapter),
      })),
    },
    clock: { now: () => new Date('2026-01-01T00:00:10.000Z') },
    jitter: () => 0,
    finalizeAccepted: vi.fn(),
  };
  return { adapter, current, dependencies, outbound, send };
};

describe('reconcileUncertainDelivery', () => {
  it('finalizes a found result without invoking send', async () => {
    const accepted = {
      remoteMessageId: 'gmail-message',
      remoteThreadId: 'gmail-thread',
      acceptedAt: new Date('2026-01-01T00:00:05.000Z'),
      providerCode: null,
      safeResponse: 'accepted' as const,
    };
    const h = createHarness(1, async () => ({
      status: 'found',
      result: accepted,
    }));

    await expect(
      reconcileUncertainDelivery(
        { deliveryId: 'delivery-1', owner: 'worker-1', leaseForMs: 60_000 },
        h.dependencies as never,
      ),
    ).resolves.toBe('sent');
    expect(h.dependencies.finalizeAccepted).toHaveBeenCalledWith({
      claimed: h.current,
      provider: 'gmail',
      accepted,
    });
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    [1, 'retry_wait'],
    [2, 'retry_wait'],
    [3, 'not_found'],
  ] as const)('handles not_found reconciliation %i without sending', async (count, expected) => {
    const h = createHarness(count, async () => ({ status: 'not_found' }));

    await expect(
      reconcileUncertainDelivery(
        {
          deliveryId: 'delivery-1',
          owner: 'worker-1',
          leaseForMs: 60_000,
        },
        h.dependencies as never,
      ),
    ).resolves.toBe(expected);
    if (count < 3) {
      expect(h.outbound.scheduleReconciliation).toHaveBeenCalledOnce();
    } else {
      expect(h.outbound.scheduleResend).toHaveBeenCalledOnce();
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it('keeps inconclusive and unsupported reconciliation uncertain', async () => {
    const inconclusive = createHarness(1, async () => ({
      status: 'inconclusive',
      retryAfter: null,
    }));
    await expect(
      reconcileUncertainDelivery(
        { deliveryId: 'delivery-1', owner: 'worker-1', leaseForMs: 60_000 },
        inconclusive.dependencies as never,
      ),
    ).resolves.toBe('retry_wait');
    expect(inconclusive.outbound.scheduleReconciliation).toHaveBeenCalledOnce();

    const unsupported = createHarness(1, undefined);
    await expect(
      reconcileUncertainDelivery(
        { deliveryId: 'delivery-1', owner: 'worker-1', leaseForMs: 60_000 },
        unsupported.dependencies as never,
      ),
    ).resolves.toBe('unsupported');
    expect(unsupported.send).not.toHaveBeenCalled();
  });
});
