import { describe, expect, it, vi } from 'vitest';

import { archiveSnoozedThreads } from '../../../../../src/modules/mail-snooze/application/archive-snoozed-threads';

describe('archiveSnoozedThreads', () => {
  it('cancels the snooze without restoring the Inbox mailbox', async () => {
    const result = { archived: ['thread-1'], notFound: [] };
    const archive = vi.fn(async () => result);
    const input = { accountId: 'account-1', threadIds: ['thread-1'] };

    await expect(archiveSnoozedThreads(input, { commands: { archive } as never })).resolves.toEqual(
      result,
    );
    expect(archive).toHaveBeenCalledWith(input);
  });
});
