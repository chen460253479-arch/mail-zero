import { createMailCore } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createSeededEmailHarness } from '../../../../../../packages/mail-core/tests/helpers/email-harness';
import type { MailSnoozeRepository, SnoozeRecord } from '../domain/snooze';
import { snoozeThreads } from './snooze-threads';

const createRepository = () => {
  const records = new Map<string, SnoozeRecord>();
  const repository: MailSnoozeRepository = {
    find: async (accountId, threadId) => records.get(`${accountId}:${threadId}`) ?? null,
    schedule: async (input) => {
      const record: SnoozeRecord = {
        ...input,
        status: 'scheduled',
        leaseOwner: null,
        leaseExpiresAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      records.set(`${input.accountId}:${input.threadId}`, record);
      return record;
    },
    cancel: async () => undefined,
    claimDue: async () => [],
    complete: async () => undefined,
    release: async () => undefined,
  };
  return { records, repository };
};

describe('snoozeThreads', () => {
  it('persists the restore mailbox and removes Inbox locally', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const { records, repository } = createRepository();
    const wakeAt = new Date(h.clock.now().getTime() + 60_000);

    const result = await snoozeThreads(
      {
        accountId: h.accountId,
        threadIds: [h.threadId],
        wakeAt,
      },
      { core, repository, clock: h.clock },
    );

    expect(result.scheduled).toEqual([h.threadId]);
    expect(records.get(`${h.accountId}:${h.threadId}`)).toMatchObject({
      restoreMailboxIds: [h.inboxId],
      status: 'scheduled',
    });
    expect(
      (await core.getEmail({ accountId: h.accountId, emailId: h.emailId })).mailboxIds,
    ).not.toContain(h.inboxId);
  });
});
