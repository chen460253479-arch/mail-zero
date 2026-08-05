import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { inboundSync } from '../../../../../src/modules/mail-sync/postgres/schema';

describe('inbound synchronization state schema', () => {
  it('persists generation, reconciliation, and dispatch lease state with constraints and indexes', () => {
    const config = getTableConfig(inboundSync);

    expect(config.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'requested_generation',
        'completed_generation',
        'pending_cursor_hint',
        'next_reconcile_at',
        'dispatch_lease_owner',
        'dispatch_lease_expires_at',
        'subscription_external_id',
        'subscription_endpoint_token_hash',
        'encrypted_subscription_secret',
        'subscription_established_at',
      ]),
    );
    expect(config.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'inbound_sync_generation_nonnegative_chk',
        'inbound_sync_generation_order_chk',
        'inbound_sync_dispatch_lease_pair_chk',
      ]),
    );
    expect(config.indexes.map(({ config: index }) => index.name)).toEqual(
      expect.arrayContaining([
        'inbound_sync_due_reconcile_idx',
        'inbound_sync_due_dispatch_idx',
        'inbound_sync_dispatch_lease_idx',
        'inbound_sync_subscription_external_idx',
        'inbound_sync_subscription_endpoint_token_idx',
      ]),
    );
    expect(
      config.indexes.find(
        ({ config: index }) => index.name === 'inbound_sync_subscription_endpoint_token_idx',
      )?.config.unique,
    ).toBe(false);
  });
});
