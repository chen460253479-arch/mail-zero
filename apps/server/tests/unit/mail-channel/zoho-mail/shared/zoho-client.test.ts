import { describe, expect, it, vi } from 'vitest';

import {
  createZohoMailClient,
  resolveZohoMailBaseUrl,
  type ZohoMailTransport,
} from '../../../../../src/mail-channel/zoho-mail/shared/zoho-client';

describe('Zoho Mail API client', () => {
  it.each([
    ['com', 'https://mail.zoho.com'],
    ['eu', 'https://mail.zoho.eu'],
    ['in', 'https://mail.zoho.in'],
    ['com.au', 'https://mail.zoho.com.au'],
    ['jp', 'https://mail.zoho.jp'],
    ['ca', 'https://mail.zohocloud.ca'],
  ])('maps the approved %s data center to a fixed host', (dataCenter, expected) => {
    expect(resolveZohoMailBaseUrl(dataCenter)).toBe(expected);
  });

  it('rejects arbitrary Zoho base URLs or unknown data centers', () => {
    expect(() => resolveZohoMailBaseUrl('https://attacker.example')).toThrow(
      'ZOHO_UNSUPPORTED_DATA_CENTER',
    );
  });

  it('resolves the first mailbox and its Inbox folder from provider APIs', async () => {
    const request = vi
      .fn<ZohoMailTransport['request']>()
      .mockResolvedValueOnce({
        status: 200,
        json: {
          status: { code: 200 },
          data: [
            {
              accountId: 'account-1',
              primaryEmailAddress: 'owner@example.com',
              displayName: 'Owner',
            },
          ],
        },
        bytes: new Uint8Array(),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: {
          status: { code: 200 },
          data: [
            {
              folderId: 'folder-1',
              folderName: 'Inbox',
              folderType: 'Inbox',
              path: '/Inbox',
            },
          ],
        },
        bytes: new Uint8Array(),
      });
    const client = createZohoMailClient({ request });

    await expect(client.getMailboxContext()).resolves.toEqual({
      accountId: 'account-1',
      inboxFolderId: 'folder-1',
      email: 'owner@example.com',
      name: 'Owner',
      picture: '',
    });
  });

  it('requests Inbox pages newest-first so incremental overlap can stop at its boundary', async () => {
    const request = vi.fn<ZohoMailTransport['request']>().mockResolvedValue({
      status: 200,
      json: { status: { code: 200 }, data: [] },
      bytes: new Uint8Array(),
    });
    const client = createZohoMailClient({ request });

    await client.listInboxMessages({
      accountId: 'account-1',
      inboxFolderId: 'folder-1',
      start: 1,
      limit: 200,
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ sortorder: 'true' }),
      }),
    );
  });
});
