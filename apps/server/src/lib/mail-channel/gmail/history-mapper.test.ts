import { describe, expect, it } from 'vitest';

import { mapGmailHistoryPage } from './history-mapper';

describe('Gmail history mapper', () => {
  it('maps only newly added Inbox messages and deduplicates their IDs', () => {
    expect(
      mapGmailHistoryPage([
        {
          messagesAdded: [
            {
              message: {
                id: 'message-1',
                threadId: 'thread-1',
                labelIds: ['INBOX', 'UNREAD'],
              },
            },
            {
              message: {
                id: 'message-not-inbox',
                threadId: 'thread-2',
                labelIds: ['IMPORTANT'],
              },
            },
          ],
          labelsAdded: [
            {
              message: { id: 'message-label', threadId: 'thread-3' },
              labelIds: ['INBOX'],
            },
          ],
          labelsRemoved: [
            {
              message: { id: 'message-1', threadId: 'thread-1' },
              labelIds: ['UNREAD'],
            },
          ],
          messagesDeleted: [{ message: { id: 'message-deleted' } }],
        },
        {
          messagesAdded: [
            {
              message: {
                id: 'message-1',
                threadId: 'thread-1',
                labelIds: ['INBOX'],
              },
            },
            {
              message: {
                id: 'message-2',
                labelIds: ['INBOX'],
              },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        type: 'message_added',
        remoteMessageId: 'message-1',
        remoteThreadId: 'thread-1',
      },
      {
        type: 'message_added',
        remoteMessageId: 'message-2',
        remoteThreadId: null,
      },
    ]);
  });
});
