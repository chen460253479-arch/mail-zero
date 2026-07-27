import { MailAccountProvider, useMailAccountContext } from './mail-account-provider';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import React from 'react';

const account = {
  id: 'account-a',
  connectionId: 'connection-a',
  status: 'active' as const,
  timezone: 'UTC',
  state: '1',
  storageQuotaBytes: null,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

function AccountState() {
  const context = useMailAccountContext();
  return <span>{`${context.status}:${context.account?.id ?? 'none'}`}</span>;
}

describe('MailAccountProvider', () => {
  it('provides the active local account selected by connection binding', () => {
    const html = renderToStaticMarkup(
      <MailAccountProvider accounts={[account]} activeConnectionId="connection-a" isLoading={false}>
        <AccountState />
      </MailAccountProvider>,
    );

    expect(html).toContain('ready:account-a');
  });

  it('does not expose an account while account discovery is loading', () => {
    const html = renderToStaticMarkup(
      <MailAccountProvider accounts={[account]} activeConnectionId="connection-a" isLoading>
        <AccountState />
      </MailAccountProvider>,
    );

    expect(html).toContain('loading:none');
  });

  it('reports a missing local account without guessing another account', () => {
    const html = renderToStaticMarkup(
      <MailAccountProvider
        accounts={[account]}
        activeConnectionId="connection-missing"
        isLoading={false}
      >
        <AccountState />
      </MailAccountProvider>,
    );

    expect(html).toContain('unavailable:none');
  });
});
