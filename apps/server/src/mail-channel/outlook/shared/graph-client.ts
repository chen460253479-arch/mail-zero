import type { MicrosoftGraphRequest, MicrosoftGraphTransport } from './graph-transport';
import type { MailChannelIdentity } from '../../contracts';
import { OutlookApiError } from './errors';

export type { MicrosoftGraphTransport } from './graph-transport';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_ROOT = `${GRAPH_ORIGIN}/v1.0`;
const immutableIdHeader = { Prefer: 'IdType="ImmutableId"' } as const;

type GraphList<T> = {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
};

export type OutlookDeltaMessage = {
  id?: string;
  conversationId?: string;
  receivedDateTime?: string;
  '@removed'?: { reason?: string };
};

export type OutlookDeltaPage = {
  messages: OutlookDeltaMessage[];
  nextLink: string | null;
  deltaLink: string | null;
};

export interface MicrosoftGraphClient {
  getIdentity(): Promise<MailChannelIdentity>;
  getDeltaPage(url: string): Promise<OutlookDeltaPage>;
  getRawMessage(remoteMessageId: string): Promise<Uint8Array>;
  createMimeDraft(rawMime: Uint8Array): Promise<{
    id: string;
    conversationId: string | null;
    internetMessageId: string | null;
  }>;
  sendDraft(remoteMessageId: string): Promise<void>;
  findSentByMessageId(messageId: string): Promise<
    Array<{
      id: string;
      conversationId: string | null;
      sentDateTime: string | null;
    }>
  >;
  createInboxSubscription(input: {
    notificationUrl: string;
    lifecycleNotificationUrl: string;
    clientState: string;
    expiresAt: Date;
  }): Promise<{ id: string; expiresAt: string }>;
  renewInboxSubscription(
    subscriptionId: string,
    expiresAt: Date,
  ): Promise<{ id: string; expiresAt: string }>;
  deleteSubscription(subscriptionId: string): Promise<void>;
}

const trustedGraphUrl = (value: string): string => {
  const url = new URL(value, GRAPH_ROOT);
  if (url.origin !== GRAPH_ORIGIN || !url.pathname.startsWith('/v1.0/')) {
    throw new OutlookApiError('OUTLOOK_UNTRUSTED_GRAPH_URL');
  }
  return url.toString();
};

const requireObject = (value: unknown, code: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OutlookApiError(code);
  }
  return value as Record<string, unknown>;
};

const request = async (
  transport: MicrosoftGraphTransport,
  input: Omit<MicrosoftGraphRequest, 'url'> & { url: string },
) =>
  await transport.request({
    ...input,
    url: trustedGraphUrl(input.url),
    headers: {
      ...immutableIdHeader,
      ...input.headers,
    },
  });

const encodeBase64 = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const escapeODataString = (value: string): string => value.replace(/'/gu, "''");

export const createMicrosoftGraphClient = (
  transport: MicrosoftGraphTransport,
): MicrosoftGraphClient => ({
  getIdentity: async () => {
    const response = await request(transport, {
      method: 'GET',
      url: `${GRAPH_ROOT}/me`,
    });
    const data = requireObject(response.json, 'OUTLOOK_INVALID_IDENTITY_RESPONSE');
    const email =
      typeof data.mail === 'string' && data.mail.length > 0
        ? data.mail
        : typeof data.userPrincipalName === 'string'
          ? data.userPrincipalName
          : '';
    if (email.length === 0) throw new OutlookApiError('OUTLOOK_IDENTITY_EMAIL_MISSING');
    return {
      email,
      name: typeof data.displayName === 'string' ? data.displayName : '',
      picture: '',
    };
  },

  getDeltaPage: async (url) => {
    const response = await request(transport, {
      method: 'GET',
      url,
    });
    const data = requireObject(
      response.json,
      'OUTLOOK_INVALID_DELTA_RESPONSE',
    ) as GraphList<OutlookDeltaMessage>;
    return {
      messages: Array.isArray(data.value) ? data.value : [],
      nextLink: typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null,
      deltaLink: typeof data['@odata.deltaLink'] === 'string' ? data['@odata.deltaLink'] : null,
    };
  },

  getRawMessage: async (remoteMessageId) => {
    const response = await request(transport, {
      method: 'GET',
      url: `${GRAPH_ROOT}/me/messages/${encodeURIComponent(remoteMessageId)}/$value`,
      headers: { Accept: 'message/rfc822' },
    });
    if (response.bytes.byteLength === 0) {
      throw new OutlookApiError('OUTLOOK_RAW_MESSAGE_MISSING');
    }
    return response.bytes;
  },

  createMimeDraft: async (rawMime) => {
    const response = await request(transport, {
      method: 'POST',
      url: `${GRAPH_ROOT}/me/messages`,
      headers: { 'Content-Type': 'text/plain' },
      body: encodeBase64(rawMime),
    });
    const data = requireObject(response.json, 'OUTLOOK_INVALID_DRAFT_RESPONSE');
    if (typeof data.id !== 'string' || data.id.length === 0) {
      throw new OutlookApiError('OUTLOOK_DRAFT_ID_MISSING');
    }
    return {
      id: data.id,
      conversationId: typeof data.conversationId === 'string' ? data.conversationId : null,
      internetMessageId: typeof data.internetMessageId === 'string' ? data.internetMessageId : null,
    };
  },

  sendDraft: async (remoteMessageId) => {
    await request(transport, {
      method: 'POST',
      url: `${GRAPH_ROOT}/me/messages/${encodeURIComponent(remoteMessageId)}/send`,
    });
  },

  findSentByMessageId: async (messageId) => {
    const url = new URL(`${GRAPH_ROOT}/me/mailFolders/sentitems/messages`);
    url.searchParams.set('$select', 'id,conversationId,sentDateTime,internetMessageId');
    url.searchParams.set('$filter', `internetMessageId eq '${escapeODataString(messageId)}'`);
    const response = await request(transport, {
      method: 'GET',
      url: url.toString(),
    });
    const data = requireObject(response.json, 'OUTLOOK_INVALID_SENT_LOOKUP_RESPONSE') as GraphList<{
      id?: unknown;
      conversationId?: unknown;
      sentDateTime?: unknown;
      internetMessageId?: unknown;
    }>;
    return (data.value ?? []).flatMap((item) =>
      typeof item.id === 'string' && item.internetMessageId === messageId
        ? [
            {
              id: item.id,
              conversationId: typeof item.conversationId === 'string' ? item.conversationId : null,
              sentDateTime: typeof item.sentDateTime === 'string' ? item.sentDateTime : null,
            },
          ]
        : [],
    );
  },

  createInboxSubscription: async (input) => {
    const response = await request(transport, {
      method: 'POST',
      url: `${GRAPH_ROOT}/subscriptions`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl: input.notificationUrl,
        lifecycleNotificationUrl: input.lifecycleNotificationUrl,
        resource: "me/mailFolders('inbox')/messages",
        expirationDateTime: input.expiresAt.toISOString(),
        clientState: input.clientState,
      }),
    });
    const data = requireObject(response.json, 'OUTLOOK_INVALID_SUBSCRIPTION_RESPONSE');
    if (typeof data.id !== 'string' || typeof data.expirationDateTime !== 'string') {
      throw new OutlookApiError('OUTLOOK_INVALID_SUBSCRIPTION_RESPONSE');
    }
    return {
      id: data.id,
      expiresAt: data.expirationDateTime,
    };
  },

  renewInboxSubscription: async (subscriptionId, expiresAt) => {
    const response = await request(transport, {
      method: 'PATCH',
      url: `${GRAPH_ROOT}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }),
    });
    const data = requireObject(response.json, 'OUTLOOK_INVALID_SUBSCRIPTION_RESPONSE');
    if (typeof data.id !== 'string' || typeof data.expirationDateTime !== 'string') {
      throw new OutlookApiError('OUTLOOK_INVALID_SUBSCRIPTION_RESPONSE');
    }
    return {
      id: data.id,
      expiresAt: data.expirationDateTime,
    };
  },

  deleteSubscription: async (subscriptionId) => {
    await request(transport, {
      method: 'DELETE',
      url: `${GRAPH_ROOT}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    });
  },
});

export const createOutlookInboxDeltaUrl = (receivedAfter: Date): string => {
  const url = new URL(`${GRAPH_ROOT}/me/mailFolders/inbox/messages/delta`);
  url.searchParams.set('$select', 'id,conversationId,receivedDateTime');
  url.searchParams.set('changeType', 'created');
  url.searchParams.set('$filter', `receivedDateTime ge ${receivedAfter.toISOString()}`);
  url.searchParams.set('$orderby', 'receivedDateTime desc');
  return url.toString();
};
