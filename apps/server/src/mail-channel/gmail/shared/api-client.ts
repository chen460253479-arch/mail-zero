import type { GmailHistoryRecord } from '../inbound/history-mapper';

type GmailProfileData = {
  emailAddress?: string | null;
  historyId?: string | null;
};

type GmailHistoryData = {
  history?: GmailHistoryRecord[] | null;
  historyId?: string | null;
  nextPageToken?: string | null;
};

type GmailRawMessageData = {
  raw?: string | null;
  internalDate?: string | null;
};

type GmailWatchData = {
  historyId?: string | null;
  expiration?: string | null;
};

export interface GmailApiTransport {
  getProfile(request: { userId: 'me' }): Promise<{ data: GmailProfileData }>;
  listHistory(request: {
    userId: 'me';
    startHistoryId: string;
    pageToken: string | null;
    labelId: 'INBOX';
  }): Promise<{ data: GmailHistoryData }>;
  getMessage(request: {
    userId: 'me';
    id: string;
    format: 'raw';
  }): Promise<{ data: GmailRawMessageData }>;
  watch(request: {
    userId: 'me';
    requestBody: {
      topicName: string;
      labelIds: ['INBOX'];
      labelFilterBehavior: 'include';
    };
  }): Promise<{ data: GmailWatchData }>;
}

export interface GmailApiClient {
  getProfile(): Promise<{
    emailAddress: string | null;
    historyId: string | null;
  }>;
  listHistory(input: { startHistoryId: string; pageToken: string | null }): Promise<{
    history: GmailHistoryRecord[];
    historyId: string | null;
    nextPageToken: string | null;
  }>;
  getRawMessage(remoteMessageId: string): Promise<{
    raw: string | null;
    internalDate: string | null;
  }>;
  watchInbox(topicName: string): Promise<{
    historyId: string | null;
    expiration: string | null;
  }>;
}

export const createGmailApiClient = (transport: GmailApiTransport): GmailApiClient => ({
  getProfile: async () => {
    const { data } = await transport.getProfile({ userId: 'me' });
    return {
      emailAddress: data.emailAddress ?? null,
      historyId: data.historyId ?? null,
    };
  },
  listHistory: async ({ startHistoryId, pageToken }) => {
    const { data } = await transport.listHistory({
      userId: 'me',
      startHistoryId,
      pageToken,
      labelId: 'INBOX',
    });
    return {
      history: data.history ?? [],
      historyId: data.historyId ?? null,
      nextPageToken: data.nextPageToken ?? null,
    };
  },
  getRawMessage: async (remoteMessageId) => {
    const { data } = await transport.getMessage({
      userId: 'me',
      id: remoteMessageId,
      format: 'raw',
    });
    return {
      raw: data.raw ?? null,
      internalDate: data.internalDate ?? null,
    };
  },
  watchInbox: async (topicName) => {
    const { data } = await transport.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      },
    });
    return {
      historyId: data.historyId ?? null,
      expiration: data.expiration ?? null,
    };
  },
});
