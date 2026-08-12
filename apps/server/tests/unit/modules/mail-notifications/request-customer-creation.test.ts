import { describe, expect, it, vi } from 'vitest';

import { createCustomerCreationRequestService } from '../../../../src/modules/mail-notifications/application/request-customer-creation';

const input = {
  accountId: 'account-1',
  messageId: 'email-1',
};

const createHarness = (inspection: 'ready' | 'not-found' | 'not-received' | 'already-marked') => {
  const repository = {
    inspect: vi.fn().mockResolvedValue(inspection),
    enqueue: vi.fn().mockResolvedValue(true),
  };
  const service = createCustomerCreationRequestService({
    repository,
    webhookEnabled: true,
    newEventId: () => 'evt-manual-1',
    clock: { now: () => new Date('2026-08-12T02:00:00.000Z') },
  });
  return { repository, service };
};

describe('customer creation request service', () => {
  it('enqueues a fresh received event with customer creation enabled', async () => {
    const { repository, service } = createHarness('ready');

    await expect(service.request(input)).resolves.toEqual({
      status: 'accepted',
      eventId: 'evt-manual-1',
    });
    expect(repository.enqueue).toHaveBeenCalledWith({
      eventId: 'evt-manual-1',
      accountId: 'account-1',
      messageId: 'email-1',
      kind: 'received',
      createCustomerIfMissing: true,
      createdAt: new Date('2026-08-12T02:00:00.000Z'),
    });
  });

  it('returns alreadyMarked without creating another event', async () => {
    const { repository, service } = createHarness('already-marked');

    await expect(service.request(input)).resolves.toEqual({
      status: 'alreadyMarked',
      eventId: null,
    });
    expect(repository.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', 'NOT_FOUND'],
    ['not-received', 'INVALID_ARGUMENTS'],
  ] as const)('maps %s inspection to %s', async (inspection, expectedCode) => {
    const { repository, service } = createHarness(inspection);

    await expect(service.request(input)).rejects.toMatchObject({
      code: expectedCode,
      retryable: false,
    });
    expect(repository.enqueue).not.toHaveBeenCalled();
  });

  it('rejects when webhook delivery is disabled without inspecting or writing', async () => {
    const { repository } = createHarness('ready');
    const service = createCustomerCreationRequestService({
      repository,
      webhookEnabled: false,
      newEventId: () => 'evt-unused',
      clock: { now: () => new Date('2026-08-12T02:00:00.000Z') },
    });

    await expect(service.request(input)).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
      retryable: true,
    });
    expect(repository.inspect).not.toHaveBeenCalled();
    expect(repository.enqueue).not.toHaveBeenCalled();
  });

  it('does not report acceptance when the guarded insert loses eligibility', async () => {
    const { repository, service } = createHarness('ready');
    repository.enqueue.mockResolvedValue(false);

    await expect(service.request(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      retryable: false,
    });
  });
});
