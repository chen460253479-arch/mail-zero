import { describe, expect, it } from 'vitest';

import { createGmailApiClient, type GmailApiTransport } from './api-client';

describe('Gmail API client boundary', () => {
  const outboundNoops = {
    sendMessage: async () => ({ data: {} }),
    uploadMessage: async () => ({ data: {} }),
    listMessages: async () => ({ data: {} }),
    getMessageMetadata: async () => ({ data: {} }),
  } satisfies Pick<
    GmailApiTransport,
    'sendMessage' | 'uploadMessage' | 'listMessages' | 'getMessageMetadata'
  >;

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
      ...outboundNoops,
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
      ...outboundNoops,
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

  it('exhausts Sent pagination and verifies exact Message-ID metadata', async () => {
    const listRequests: unknown[] = [];
    const metadataRequests: unknown[] = [];
    const transport: GmailApiTransport = {
      getProfile: async () => ({ data: {} }),
      listHistory: async () => ({ data: {} }),
      getMessage: async () => ({ data: {} }),
      watch: async () => ({ data: {} }),
      sendMessage: async () => ({ data: {} }),
      uploadMessage: async () => ({ data: {} }),
      listMessages: async (request) => {
        listRequests.push(request);
        return request.pageToken === null
          ? {
              data: {
                messages: [{ id: 'candidate-1' }],
                nextPageToken: 'page-2',
              },
            }
          : { data: { messages: [{ id: 'candidate-2' }] } };
      },
      getMessageMetadata: async (request) => {
        metadataRequests.push(request);
        return {
          data: {
            id: request.id,
            threadId: `thread-${request.id}`,
            internalDate: request.id === 'candidate-1' ? '2000' : '1000',
            payload: {
              headers: [
                {
                  name: 'Message-ID',
                  value:
                    request.id === 'candidate-1' ? '<other@example.test>' : '<stable@example.test>',
                },
              ],
            },
          },
        };
      },
    };

    await expect(
      createGmailApiClient(transport).findSentByMessageId('<stable@example.test>'),
    ).resolves.toEqual([
      {
        id: 'candidate-2',
        threadId: 'thread-candidate-2',
        internalDate: '1000',
      },
    ]);
    expect(listRequests).toEqual([
      {
        userId: 'me',
        labelIds: ['SENT'],
        q: 'in:sent rfc822msgid:<stable@example.test>',
        pageToken: null,
      },
      {
        userId: 'me',
        labelIds: ['SENT'],
        q: 'in:sent rfc822msgid:<stable@example.test>',
        pageToken: 'page-2',
      },
    ]);
    expect(metadataRequests).toHaveLength(2);
  });
});
