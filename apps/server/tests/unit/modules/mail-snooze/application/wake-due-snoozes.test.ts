import type { MailSnoozeRepository, SnoozeRecord } from '../../../../../src/modules/mail-snooze/domain/snooze';
import { wakeDueSnoozes } from '../../../../../src/modules/mail-snooze/application/wake-due-snoozes';
import { describe, expect, it, vi } from 'vitest';

describe('wakeDueSnoozes', () => {
  it('restores one claimed Snooze once and completes its lease', async () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    const snooze: SnoozeRecord = {
      accountId: 'account-1',
      threadId: 'thread-1',
      wakeAt: now,
      restorePlan: [
        { emailId: 'email-1', addMailboxIds: ['inbox'], removeMailboxIds: ['archive'] },
      ],
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
    const repository = {
      claimDue,
      release: vi.fn(async () => undefined),
    } as unknown as MailSnoozeRepository;
    const wakeClaimed = vi.fn(async () => true);
    const dependencies = {
      commands: { wakeClaimed },
      repository,
    };
    const input = { now, limit: 100, leaseOwner: 'worker-1', leaseForMs: 60_000 };

    await wakeDueSnoozes(input, dependencies);
    await wakeDueSnoozes(input, dependencies);

    expect(wakeClaimed).toHaveBeenCalledOnce();
  });
});
