import { gmailSentMessageIdQuery } from '../outbound/reconciliation';
import type { GmailHistoryRecord } from '../inbound/history-mapper';
import { buildGmailSendRequest } from '../outbound/mime-request';

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

type GmailSendData = {
  id?: string | null;
  threadId?: string | null;
};

type GmailMessageListData = {
  messages?: Array<{ id?: string | null }> | null;
  nextPageToken?: string | null;
};

type GmailMetadataData = {
  id?: string | null;
  threadId?: string | null;
  internalDate?: string | null;
  payload?: {
    headers?: Array<{
      name?: string | null;
      value?: string | null;
    }> | null;
  } | null;
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
  sendMessage(request: {
    userId: 'me';
    requestBody: { raw: string; threadId?: string };
  }): Promise<{ data: GmailSendData }>;
  uploadMessage(request: {
    userId: 'me';
    requestBody: { threadId?: string };
    media: { mimeType: 'message/rfc822'; body: Uint8Array };
  }): Promise<{ data: GmailSendData }>;
  listMessages(request: {
    userId: 'me';
    labelIds: ['SENT'];
    q: string;
    pageToken: string | null;
  }): Promise<{ data: GmailMessageListData }>;
  getMessageMetadata(request: {
    userId: 'me';
    id: string;
    format: 'metadata';
    metadataHeaders: ['Message-ID'];
  }): Promise<{ data: GmailMetadataData }>;
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
  sendRawMessage(input: {
    raw: Uint8Array;
    remoteThreadId: string | null;
  }): Promise<{ id: string | null; threadId: string | null }>;
  findSentByMessageId(messageId: string): Promise<
    Array<{
      id: string;
      threadId: string | null;
      internalDate: string | null;
    }>
  >;
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
  sendRawMessage: async ({ raw, remoteThreadId }) => {
    const request = buildGmailSendRequest(raw, remoteThreadId);
    const { data } =
      request.mode === 'json'
        ? await transport.sendMessage({
            userId: 'me',
            requestBody: request.requestBody,
          })
        : await transport.uploadMessage({
            userId: 'me',
            requestBody: request.requestBody,
            media: request.media,
          });
    return {
      id: data.id ?? null,
      threadId: data.threadId ?? null,
    };
  },
  findSentByMessageId: async (messageId) => {
    const query = gmailSentMessageIdQuery(messageId);
    const ids: string[] = [];
    const seenTokens = new Set<string>();
    let pageToken: string | null = null;
    do {
      const { data } = await transport.listMessages({
        userId: 'me',
        labelIds: ['SENT'],
        q: query,
        pageToken,
      });
      ids.push(
        ...(data.messages ?? []).flatMap(({ id }) => (id === null || id === undefined ? [] : [id])),
      );
      const next = data.nextPageToken ?? null;
      if (next !== null && seenTokens.has(next)) break;
      if (next !== null) seenTokens.add(next);
      pageToken = next;
    } while (pageToken !== null);

    const matches = await Promise.all(
      ids.map(async (id) => {
        const { data } = await transport.getMessageMetadata({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['Message-ID'],
        });
        const header = data.payload?.headers?.find(
          ({ name }) => name?.toLowerCase() === 'message-id',
        )?.value;
        return header?.trim() === messageId
          ? {
              id: data.id ?? id,
              threadId: data.threadId ?? null,
              internalDate: data.internalDate ?? null,
            }
          : null;
      }),
    );
    return matches.filter((match) => match !== null);
  },
});
