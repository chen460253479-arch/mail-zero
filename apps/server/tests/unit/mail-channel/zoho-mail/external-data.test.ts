import { describe, expect, it } from 'vitest';

import {
  mergeZohoMailExternalData,
  parseZohoMailExternalData,
} from '../../../../src/mail-channel/zoho-mail/external-data';

describe('Zoho Mail external binding data', () => {
  it('accepts account-only data as an incomplete first configuration stage', () => {
    expect(parseZohoMailExternalData({ accountId: '2560636000000008002' })).toEqual({
      accountId: '2560636000000008002',
    });
  });

  it('accepts only an account ID and one or more unique folder IDs', () => {
    expect(
      parseZohoMailExternalData({
        accountId: '2560636000000008002',
        folderIds: ['2560636000000012001', '2560636000000012002'],
      }),
    ).toEqual({
      accountId: '2560636000000008002',
      folderIds: ['2560636000000012001', '2560636000000012002'],
    });
  });

  it.each([
    { accountId: '1', folderIds: [] },
    { accountId: '1', folderIds: ['2', '2'] },
    { accountId: 'account-1', folderIds: ['2'] },
    { accountId: '1', folderIds: ['folder-2'] },
    { accountId: '1', folderIds: ['2'], version: 1 },
  ])('rejects invalid or additional fields: $version', (value) => {
    expect(() => parseZohoMailExternalData(value)).toThrow();
  });

  it('keeps configured folders when an account-only retry targets the same account', () => {
    expect(
      mergeZohoMailExternalData({ accountId: '100', folderIds: ['200'] }, { accountId: '100' }),
    ).toEqual({ accountId: '100', folderIds: ['200'] });
  });

  it('clears folders when the account changes and replaces folders when supplied', () => {
    expect(
      mergeZohoMailExternalData({ accountId: '100', folderIds: ['200'] }, { accountId: '999' }),
    ).toEqual({ accountId: '999' });
    expect(
      mergeZohoMailExternalData(
        { accountId: '100', folderIds: ['200'] },
        { accountId: '100', folderIds: ['300'] },
      ),
    ).toEqual({ accountId: '100', folderIds: ['300'] });
  });
});
