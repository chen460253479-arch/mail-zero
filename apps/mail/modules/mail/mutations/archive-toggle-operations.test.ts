import { describe, expect, it } from 'vitest';

import { createArchiveToggleOperations } from './archive-toggle-operations';

describe('createArchiveToggleOperations', () => {
  it('archives immediately and restores the thread to Inbox when reverted', async () => {
    const moves: string[] = [];
    const operations = createArchiveToggleOperations({
      accountId: 'account-1',
      currentFolder: 'inbox',
      destination: 'archive',
      moveBetween: async (source, destination) => {
        moves.push(`${source}->${destination}`);
      },
    });

    expect(operations).not.toBeNull();
    await operations?.execute();
    await operations?.revert();

    expect(operations?.queueKey).toBe('account-1:archive-toggle');
    expect(moves).toEqual(['inbox->archive', 'archive->inbox']);
  });

  it('leaves lifecycle-aware unarchive outside the reversible Inbox-only operation', () => {
    const operations = createArchiveToggleOperations({
      accountId: 'account-1',
      currentFolder: 'archive',
      destination: 'inbox',
      moveBetween: async () => undefined,
    });

    expect(operations).toBeNull();
  });

  it('does not turn unrelated mailbox moves into archive toggles', () => {
    expect(
      createArchiveToggleOperations({
        accountId: 'account-1',
        currentFolder: 'inbox',
        destination: 'bin',
        moveBetween: async () => undefined,
      }),
    ).toBeNull();
  });
});
