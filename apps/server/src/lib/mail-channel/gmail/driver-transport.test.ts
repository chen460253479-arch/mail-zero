import type { gmail_v1 } from '@googleapis/gmail';
import { describe, expect, it, vi } from 'vitest';

import { createGmailTransportFromExecutor, type GmailApiExecutor } from './driver-transport';

describe('Gmail driver transport', () => {
  it('executes every ingress API call through the credential-aware driver boundary', async () => {
    const api = {
      users: {
        getProfile: vi.fn(async () => ({ data: { historyId: '100' } })),
        history: {
          list: vi.fn(async () => ({ data: { historyId: '101' } })),
        },
        messages: {
          get: vi.fn(async () => ({ data: { raw: 'cmF3' } })),
        },
        watch: vi.fn(async () => ({ data: { expiration: '123' } })),
      },
    };
    let runCalls = 0;
    const executor: GmailApiExecutor = {
      async runGmailApi<Result>(operation: (client: gmail_v1.Gmail) => Promise<Result>) {
        runCalls += 1;
        return operation(api as unknown as gmail_v1.Gmail);
      },
    };
    const transport = createGmailTransportFromExecutor(executor);

    await transport.getProfile({ userId: 'me' });
    await transport.listHistory({
      userId: 'me',
      startHistoryId: '100',
      pageToken: null,
      labelId: 'INBOX',
    });
    await transport.getMessage({ userId: 'me', id: 'message-1', format: 'raw' });
    await transport.watch({
      userId: 'me',
      requestBody: {
        topicName: 'projects/zero/topics/inbox',
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      },
    });

    expect(runCalls).toBe(4);
    expect(api.users.getProfile).toHaveBeenCalledWith({ userId: 'me' });
    expect(api.users.history.list).toHaveBeenCalledWith({
      userId: 'me',
      startHistoryId: '100',
      labelId: 'INBOX',
    });
    expect(api.users.messages.get).toHaveBeenCalledWith({
      userId: 'me',
      id: 'message-1',
      format: 'raw',
    });
    expect(api.users.watch).toHaveBeenCalledWith({
      userId: 'me',
      requestBody: {
        topicName: 'projects/zero/topics/inbox',
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      },
    });
  });
});
