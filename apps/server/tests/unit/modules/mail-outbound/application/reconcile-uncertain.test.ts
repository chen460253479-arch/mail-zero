import { describe, expect, it, vi } from 'vitest';

import { reconcileUncertainDelivery } from '../../../../../src/modules/mail-outbound/application/reconcile-uncertain';
import type { ClaimedDelivery } from '../../../../../src/modules/mail-outbound/domain/delivery';

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
    scheduleResend: vi.fn(),
  };
  const send = vi.fn();
  const adapter = {
    provider: 'gmail',
    send,
    classifyError: vi.fn(),
    ...(reconcile === undefined ? {} : { reconcile }),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
    finalizeFailed: vi.fn(),
    logger,
  };
  return { adapter, current, dependencies, logger, outbound, send };
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
    expect(h.logger.info).toHaveBeenCalledWith(
      'mail.outbound.reconciliation_succeeded',
      expect.objectContaining({
        deliveryId: 'delivery-1',
        submissionId: 'submission-1',
        reconciliationCount: 1,
        provider: 'gmail',
      }),
    );
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3] as const)(
    'fails without resending after not_found reconciliation %i',
    async (count) => {
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
      ).resolves.toBe('failed');
      expect(h.outbound.scheduleResend).not.toHaveBeenCalled();
      expect(h.dependencies.finalizeFailed).toHaveBeenCalledWith({
        claimed: h.current,
        classification: expect.objectContaining({ providerCode: 'RECONCILIATION_NOT_FOUND' }),
        failedAt: new Date('2026-01-01T00:00:10.000Z'),
      });
      expect(h.send).not.toHaveBeenCalled();
    },
  );

  it('fails without resending for inconclusive and unsupported reconciliation', async () => {
    const inconclusive = createHarness(1, async () => ({
      status: 'inconclusive',
      retryAfter: null,
    }));
    await expect(
      reconcileUncertainDelivery(
        { deliveryId: 'delivery-1', owner: 'worker-1', leaseForMs: 60_000 },
        inconclusive.dependencies as never,
      ),
    ).resolves.toBe('failed');
    expect(inconclusive.outbound.scheduleResend).not.toHaveBeenCalled();
    expect(inconclusive.dependencies.finalizeFailed).toHaveBeenCalledOnce();
    expect(inconclusive.logger.error).toHaveBeenCalledWith(
      'mail.outbound.reconciliation_inconclusive',
      expect.objectContaining({
        deliveryId: 'delivery-1',
        reconciliationCount: 1,
        provider: 'gmail',
        action: 'delivery_failed_no_retry',
      }),
    );

    const unsupported = createHarness(1, undefined);
    await expect(
      reconcileUncertainDelivery(
        { deliveryId: 'delivery-1', owner: 'worker-1', leaseForMs: 60_000 },
        unsupported.dependencies as never,
      ),
    ).resolves.toBe('failed');
    expect(unsupported.outbound.scheduleResend).not.toHaveBeenCalled();
    expect(unsupported.dependencies.finalizeFailed).toHaveBeenCalledOnce();
    expect(unsupported.logger.warn).toHaveBeenCalledWith(
      'mail.outbound.reconciliation_unsupported',
      expect.objectContaining({
        deliveryId: 'delivery-1',
        provider: 'gmail',
        action: 'delivery_failed_no_retry',
      }),
    );
    expect(unsupported.send).not.toHaveBeenCalled();
  });

  it('fails without resending when reconciliation throws', async () => {
    const h = createHarness(1, async () => {
      throw new Error('reconciliation unavailable');
    });
    h.adapter.classifyError.mockReturnValue({
      kind: 'temporary_failure',
      providerCode: 'TEMP',
      safeResponse: 'temporary_failure',
      retryAfter: null,
    });

    await expect(
      reconcileUncertainDelivery(
        { deliveryId: 'delivery-1', owner: 'worker-1', leaseForMs: 60_000 },
        h.dependencies as never,
      ),
    ).resolves.toBe('failed');
    expect(h.outbound.scheduleResend).not.toHaveBeenCalled();
    expect(h.dependencies.finalizeFailed).toHaveBeenCalledOnce();
    expect(h.logger.error).toHaveBeenCalledWith(
      'mail.outbound.reconciliation_failed',
      expect.objectContaining({
        deliveryId: 'delivery-1',
        action: 'delivery_failed_no_retry',
        errorMessage: 'reconciliation unavailable',
      }),
    );
  });
});
