import { selectMailAccount } from './mail-account-selection';
import { describe, expect, it } from 'vitest';

const accounts = [
  {
    id: 'account-a',
    connectionId: 'connection-a',
    status: 'active' as const,
    timezone: 'UTC',
    state: '1',
    storageQuotaBytes: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  },
  {
    id: 'account-b',
    connectionId: 'connection-b',
    status: 'suspended' as const,
    timezone: 'UTC',
    state: '2',
    storageQuotaBytes: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  },
];

describe('selectMailAccount', () => {
  it('resolves the local account bound to the active connection', () => {
    expect(selectMailAccount(accounts, 'connection-a')?.id).toBe('account-a');
  });

  it('does not select a suspended account for mailbox requests', () => {
    expect(selectMailAccount(accounts, 'connection-b')).toBeNull();
  });

  it('does not guess an account when no active connection is selected', () => {
    expect(selectMailAccount(accounts, null)).toBeNull();
  });
});
