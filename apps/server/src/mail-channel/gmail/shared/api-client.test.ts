import { describe, expect, it } from 'vitest';

import { createGmailApiClient, type GmailApiTransport } from './api-client';

describe('Gmail API client boundary', () => {
  it('restricts History discovery to Inbox and preserves pagination data', async () => {
    let received: unknown;
    const transport: GmailApiTransport = {
      getProfile: async () => ({ data: {} }),
      listHistory: async (request) => {
        received = request;
        return {
          data: {
            history: [{ id: '101' }],
            historyId: '102',
            nextPageToken: 'next-page',
          },
        };
      },
      getMessage: async () => ({ data: {} }),
      watch: async () => ({ data: {} }),
    };

    const result = await createGmailApiClient(transport).listHistory({
      startHistoryId: '100',
      pageToken: 'page-1',
    });

    expect(received).toEqual({
      userId: 'me',
      startHistoryId: '100',
      pageToken: 'page-1',
      labelId: 'INBOX',
    });
    expect(result).toEqual({
      history: [{ id: '101' }],
      historyId: '102',
      nextPageToken: 'next-page',
    });
  });

  it('creates an Inbox-only Watch subscription', async () => {
    let received: unknown;
    const transport: GmailApiTransport = {
      getProfile: async () => ({ data: {} }),
      listHistory: async () => ({ data: {} }),
      getMessage: async () => ({ data: {} }),
      watch: async (request) => {
        received = request;
        return {
          data: {
            historyId: '200',
            expiration: '1785542400000',
          },
        };
      },
    };

    const result = await createGmailApiClient(transport).watchInbox('projects/zero/topics/gmail');

    expect(received).toEqual({
      userId: 'me',
      requestBody: {
        topicName: 'projects/zero/topics/gmail',
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      },
    });
    expect(result).toEqual({
      historyId: '200',
      expiration: '1785542400000',
    });
  });
});
