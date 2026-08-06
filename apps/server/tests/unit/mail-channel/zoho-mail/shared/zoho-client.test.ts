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

  it('does not call Zoho when CRM binding data is missing', async () => {
    const request = vi.fn<ZohoMailTransport['request']>();
    const client = createZohoMailClient({ request });

    await expect(client.getMailboxContext()).rejects.toThrow('ZOHO_MAIL_BINDING_INCOMPLETE');
    expect(request).not.toHaveBeenCalled();
  });

  it('uses the exact account and folders selected by the external integration', async () => {
    const request = vi
      .fn<ZohoMailTransport['request']>()
      .mockResolvedValueOnce({
        status: 200,
        json: {
          status: { code: 200 },
          data: [
            { accountId: '100', primaryEmailAddress: 'first@example.com' },
            { accountId: '200', primaryEmailAddress: 'selected@example.com' },
          ],
        },
        bytes: new Uint8Array(),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: {
          status: { code: 200 },
          data: [
            { folderId: '300', folderName: 'Inbox' },
            { folderId: '400', folderName: 'CRM' },
          ],
        },
        bytes: new Uint8Array(),
      });
    const client = createZohoMailClient(
      { request },
      { accountId: '200', folderIds: ['400', '300'] },
    );

    await expect(client.getMailboxContext()).resolves.toMatchObject({
      accountId: '200',
      folderIds: ['400', '300'],
      email: 'selected@example.com',
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      path: '/api/accounts/200/folders',
    });
  });

  it('validates an account-only first stage without selecting or requesting folders', async () => {
    const request = vi.fn<ZohoMailTransport['request']>().mockResolvedValueOnce({
      status: 200,
      json: {
        status: { code: 200 },
        data: [{ accountId: '200', primaryEmailAddress: 'selected@example.com' }],
      },
      bytes: new Uint8Array(),
    });
    const client = createZohoMailClient({ request }, { accountId: '200' });

    await expect(client.getMailboxContext()).resolves.toMatchObject({
      accountId: '200',
      folderIds: [],
      email: 'selected@example.com',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('requests Inbox pages newest-first so incremental overlap can stop at its boundary', async () => {
    const request = vi.fn<ZohoMailTransport['request']>().mockResolvedValue({
      status: 200,
      json: { status: { code: 200 }, data: [] },
      bytes: new Uint8Array(),
    });
    const client = createZohoMailClient({ request });

    await client.listFolderMessages({
      accountId: 'account-1',
      folderId: 'folder-1',
      start: 1,
      limit: 200,
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ sortorder: 'false' }),
      }),
    );
  });
});
