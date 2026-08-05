import { describe, expect, it } from 'vitest';

import {
  createZohoMailIngressScopes,
  resolveZohoMailIngressScope,
} from '../../../../../src/mail-channel/zoho-mail/inbound/scope';

const mailbox = {
  accountId: '100',
  folderIds: ['200', '300'],
  email: 'owner@example.com',
  name: 'Owner',
  picture: '' as const,
};

describe('Zoho Mail inbound scopes', () => {
  it('creates no synchronization stream for an account-only first stage', () => {
    expect(createZohoMailIngressScopes({ accountId: '100' })).toEqual([]);
  });

  it('creates one durable synchronization stream per selected folder', () => {
    expect(createZohoMailIngressScopes({ accountId: '100', folderIds: ['200', '300'] })).toEqual([
      {
        scopeKey: 'folder:200',
        scope: {
          version: 1,
          mailboxRoles: ['inbox'],
          initialSync: 'none',
          externalData: { accountId: '100', folderIds: ['200'] },
        },
      },
      {
        scopeKey: 'folder:300',
        scope: {
          version: 1,
          mailboxRoles: ['inbox'],
          initialSync: 'none',
          externalData: { accountId: '100', folderIds: ['300'] },
        },
      },
    ]);
  });

  it('resolves the exact account and folder from a persisted scope', () => {
    const [scope] = createZohoMailIngressScopes({ accountId: '100', folderIds: ['300'] });

    expect(resolveZohoMailIngressScope(scope!.scope, mailbox)).toEqual({
      accountId: '100',
      folderId: '300',
    });
  });

  it('rejects a scope that no longer matches the bound mailbox context', () => {
    const [scope] = createZohoMailIngressScopes({ accountId: '999', folderIds: ['300'] });

    expect(() => resolveZohoMailIngressScope(scope!.scope, mailbox)).toThrow(
      'ZOHO_MAILBOX_CONTEXT_CHANGED',
    );
  });
});
