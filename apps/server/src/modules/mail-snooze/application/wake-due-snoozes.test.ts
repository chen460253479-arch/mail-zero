import { describe, expect, it, vi } from 'vitest';
import type { MailCore } from '@zero/mail-core';

import type { MailSnoozeRepository, SnoozeRecord } from '../domain/snooze';
import { wakeDueSnoozes } from './wake-due-snoozes';

describe('wakeDueSnoozes', () => {
  it('restores one claimed Snooze once and completes its lease', async () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    const snooze: SnoozeRecord = {
      accountId: 'account-1',
      threadId: 'thread-1',
      wakeAt: now,
      restoreMailboxIds: ['inbox'],
      status: 'waking',
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    };
    const claimDue = vi
      .fn<MailSnoozeRepository['claimDue']>()
      .mockResolvedValueOnce([snooze])
      .mockResolvedValueOnce([]);
    const complete = vi.fn(async () => undefined);
    const repository = {
      claimDue,
      complete,
      release: vi.fn(async () => undefined),
    } as unknown as MailSnoozeRepository;
    const updateThreadEmails = vi.fn(async () => ({
      oldState: '1',
      newState: '2',
      updatedThreadIds: ['thread-1'],
      failed: {},
    }));
    const dependencies = {
      core: {
        updateThreadEmails,
        listMailboxes: vi.fn(async () => [{ id: 'archive', role: 'archive' }]),
      } as unknown as MailCore,
      repository,
    };
    const input = { now, limit: 100, leaseOwner: 'worker-1', leaseForMs: 60_000 };

    await wakeDueSnoozes(input, dependencies);
    await wakeDueSnoozes(input, dependencies);

    expect(updateThreadEmails).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });
});
