import { describe, expect, it } from 'vitest';

import {
  createOutlookCheckpoint,
  parseOutlookCheckpoint,
} from '../../../../../src/mail-channel/outlook/inbound/checkpoint';

describe('Outlook Inbox delta checkpoint', () => {
  it('round-trips the immutable Inbox cursor and successful boundary', () => {
    const checkpoint = createOutlookCheckpoint({
      cursorUrl:
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque',
      lastSuccessfulAt: new Date('2026-07-28T12:00:00.000Z'),
    });

    expect(parseOutlookCheckpoint(checkpoint)).toEqual({
      version: 1,
      inboxFolderId: 'inbox',
      cursorUrl:
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=opaque',
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
    });
  });

  it('rejects an external continuation URL', () => {
    expect(() =>
      parseOutlookCheckpoint({
        version: 1,
        inboxFolderId: 'inbox',
        cursorUrl: 'https://attacker.example/messages/delta',
        lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
      }),
    ).toThrow('OUTLOOK_INVALID_CHECKPOINT');
  });
});
