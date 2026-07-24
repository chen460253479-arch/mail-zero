import { describe, expect, it } from 'vitest';

import { gmailSyncAdapter, mapGmailHistory } from './gmail-sync';

describe('Gmail sync adapter', () => {
  it('parses a Gmail history notification into a provider-neutral push event', () => {
    expect(
      gmailSyncAdapter.parsePushEvent({
        emailAddress: 'User@Example.com',
        historyId: '123',
      }),
    ).toEqual({
      mailbox: 'user@example.com',
      cursor: '123',
    });
  });

  it('rejects a push payload without a history ID', () => {
    expect(() =>
      gmailSyncAdapter.parsePushEvent({ emailAddress: 'user@example.com' }),
    ).toThrow();
  });

  it('returns changed message IDs and the next cursor', () => {
    expect(
      mapGmailHistory(
        [
          {
            messagesAdded: [
              {
                message: {
                  id: 'message-1',
                  threadId: 'thread-1',
                  labelIds: ['INBOX'],
                },
              },
            ],
            labelsRemoved: [
              {
                message: { id: 'message-2', threadId: 'thread-2' },
                labelIds: ['UNREAD'],
              },
            ],
          },
        ],
        '456',
      ),
    ).toEqual({
      changes: [
        {
          remoteMessageId: 'message-1',
          remoteThreadId: 'thread-1',
          addedLabelIds: ['INBOX'],
          removedLabelIds: [],
          deleted: false,
        },
        {
          remoteMessageId: 'message-2',
          remoteThreadId: 'thread-2',
          addedLabelIds: [],
          removedLabelIds: ['UNREAD'],
          deleted: false,
        },
      ],
      nextCursor: '456',
    });
  });
});
