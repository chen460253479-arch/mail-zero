import { describe, expect, it } from 'vitest';

import {
  createZohoMailCheckpoint,
  parseZohoMailCheckpoint,
} from '../../../../../src/mail-channel/zoho-mail/inbound/checkpoint';

describe('Zoho Mail composite checkpoint', () => {
  it('stores account, folder, timestamp, message ID, and successful boundary', () => {
    const checkpoint = createZohoMailCheckpoint({
      accountId: 'account-1',
      folderId: 'folder-1',
      receivedTime: '1785240000000',
      messageId: 'message-9',
      baselineReceivedTime: '1785239900000',
      lastSuccessfulAt: new Date('2026-07-28T12:00:00.000Z'),
    });

    expect(parseZohoMailCheckpoint(checkpoint)).toEqual({
      version: 2,
      accountId: 'account-1',
      folderId: 'folder-1',
      receivedTime: '1785240000000',
      messageId: 'message-9',
      baselineReceivedTime: '1785239900000',
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
    });
  });

  it('normalizes legacy Inbox checkpoints without losing the cursor', () => {
    expect(
      parseZohoMailCheckpoint({
        version: 1,
        accountId: 'account-1',
        inboxFolderId: 'folder-1',
        receivedTime: '1785240000000',
        messageId: 'message-9',
        baselineReceivedTime: '1785239900000',
        lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
      }),
    ).toMatchObject({
      version: 2,
      accountId: 'account-1',
      folderId: 'folder-1',
      messageId: 'message-9',
    });
  });
});
