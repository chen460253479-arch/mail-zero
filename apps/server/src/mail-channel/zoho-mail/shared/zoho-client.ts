import type { ZohoMailTransport } from './zoho-transport';
import { ZohoMailApiError } from './errors';

export type { ZohoMailTransport } from './zoho-transport';

const dataCenters = {
  com: 'https://mail.zoho.com',
  eu: 'https://mail.zoho.eu',
  in: 'https://mail.zoho.in',
  'com.au': 'https://mail.zoho.com.au',
  jp: 'https://mail.zoho.jp',
  ca: 'https://mail.zohocloud.ca',
  sa: 'https://mail.zoho.sa',
} as const;

export type ZohoDataCenter = keyof typeof dataCenters;

export const resolveZohoMailBaseUrl = (dataCenter: string): string => {
  const baseUrl = dataCenters[dataCenter as ZohoDataCenter];
  if (baseUrl === undefined) throw new ZohoMailApiError('ZOHO_UNSUPPORTED_DATA_CENTER');
  return baseUrl;
};

export type ZohoMailboxContext = {
  accountId: string;
  inboxFolderId: string;
  email: string;
  name: string;
  picture: '';
};

export type ZohoMessageSummary = {
  messageId: string;
  threadId: string | null;
  receivedTime: string;
  folderId: string;
};

export type ZohoUploadedAttachment = {
  storeName: string;
  attachmentPath: string;
  attachmentName: string;
};

export interface ZohoMailClient {
  getMailboxContext(): Promise<ZohoMailboxContext>;
  listInboxMessages(input: {
    accountId: string;
    inboxFolderId: string;
    start: number;
    limit: number;
  }): Promise<ZohoMessageSummary[]>;
  getOriginalMessage(input: {
    accountId: string;
    inboxFolderId: string;
    messageId: string;
  }): Promise<Uint8Array>;
  uploadAttachment(input: {
    accountId: string;
    filename: string;
    bytes: Uint8Array;
  }): Promise<ZohoUploadedAttachment>;
  sendMessage(input: {
    accountId: string;
    body: Record<string, unknown>;
  }): Promise<{ messageId: string; mailId: string | null }>;
  replyToMessage(input: {
    accountId: string;
    parentMessageId: string;
    body: Record<string, unknown>;
  }): Promise<{ messageId: string; mailId: string | null }>;
}

const requireRecord = (value: unknown, code: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ZohoMailApiError(code);
  }
  return value as Record<string, unknown>;
};

const responseData = (value: unknown, code: string): unknown => {
  const envelope = requireRecord(value, code);
  const status = envelope.status;
  if (typeof status === 'object' && status !== null && !Array.isArray(status)) {
    const providerCode = (status as Record<string, unknown>).code;
    if (typeof providerCode === 'number' && providerCode !== 200) {
      throw new ZohoMailApiError(`ZOHO_PROVIDER_${providerCode}`);
    }
  }
  return envelope.data;
};

const parseSendResult = (value: unknown): { messageId: string; mailId: string | null } => {
  const data = requireRecord(
    responseData(value, 'ZOHO_INVALID_SEND_RESPONSE'),
    'ZOHO_INVALID_SEND_RESPONSE',
  );
  if (typeof data.messageId !== 'string' || data.messageId.length === 0) {
    throw new ZohoMailApiError('ZOHO_SEND_MESSAGE_ID_MISSING');
  }
  return {
    messageId: data.messageId,
    mailId: typeof data.mailId === 'string' ? data.mailId : null,
  };
};

export const createZohoMailClient = (transport: ZohoMailTransport): ZohoMailClient => ({
  getMailboxContext: async () => {
    const accountsResponse = await transport.request({ method: 'GET', path: '/api/accounts' });
    const accounts = responseData(accountsResponse.json, 'ZOHO_INVALID_ACCOUNTS_RESPONSE');
    if (!Array.isArray(accounts)) throw new ZohoMailApiError('ZOHO_INVALID_ACCOUNTS_RESPONSE');
    const account = accounts
      .map((value) => requireRecord(value, 'ZOHO_INVALID_ACCOUNT'))
      .find(
        (value) =>
          typeof value.accountId === 'string' &&
          (typeof value.primaryEmailAddress === 'string' ||
            typeof value.mailboxAddress === 'string'),
      );
    if (account === undefined) throw new ZohoMailApiError('ZOHO_MAILBOX_ACCOUNT_MISSING');
    const accountId = String(account.accountId);
    const foldersResponse = await transport.request({
      method: 'GET',
      path: `/api/accounts/${encodeURIComponent(accountId)}/folders`,
    });
    const folders = responseData(foldersResponse.json, 'ZOHO_INVALID_FOLDERS_RESPONSE');
    if (!Array.isArray(folders)) throw new ZohoMailApiError('ZOHO_INVALID_FOLDERS_RESPONSE');
    const inbox = folders
      .map((value) => requireRecord(value, 'ZOHO_INVALID_FOLDER'))
      .find(
        (value) =>
          typeof value.folderId === 'string' &&
          [value.folderType, value.folderName, value.path].some(
            (candidate) =>
              typeof candidate === 'string' &&
              candidate.toLocaleLowerCase('en-US').replace(/^\//u, '') === 'inbox',
          ),
      );
    if (inbox === undefined) throw new ZohoMailApiError('ZOHO_INBOX_FOLDER_MISSING');
    return {
      accountId,
      inboxFolderId: String(inbox.folderId),
      email:
        typeof account.primaryEmailAddress === 'string'
          ? account.primaryEmailAddress
          : String(account.mailboxAddress),
      name:
        typeof account.displayName === 'string'
          ? account.displayName
          : typeof account.accountDisplayName === 'string'
            ? account.accountDisplayName
            : '',
      picture: '',
    };
  },

  listInboxMessages: async ({ accountId, inboxFolderId, start, limit }) => {
    const response = await transport.request({
      method: 'GET',
      path: `/api/accounts/${encodeURIComponent(accountId)}/messages/view`,
      query: {
        folderId: inboxFolderId,
        start: String(start),
        limit: String(limit),
        sortorder: 'true',
      },
    });
    const data = responseData(response.json, 'ZOHO_INVALID_MESSAGE_LIST_RESPONSE');
    if (!Array.isArray(data)) throw new ZohoMailApiError('ZOHO_INVALID_MESSAGE_LIST_RESPONSE');
    return data.flatMap((value) => {
      const message = requireRecord(value, 'ZOHO_INVALID_MESSAGE');
      return typeof message.messageId === 'string' && typeof message.receivedTime === 'string'
        ? [
            {
              messageId: message.messageId,
              threadId: typeof message.threadId === 'string' ? message.threadId : null,
              receivedTime: message.receivedTime,
              folderId: typeof message.folderId === 'string' ? message.folderId : inboxFolderId,
            },
          ]
        : [];
    });
  },

  getOriginalMessage: async ({ accountId, inboxFolderId, messageId }) => {
    const response = await transport.request({
      method: 'GET',
      path: `/api/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(inboxFolderId)}/messages/${encodeURIComponent(messageId)}/originalmessage`,
      headers: { Accept: 'message/rfc822' },
    });
    if (response.bytes.byteLength === 0) throw new ZohoMailApiError('ZOHO_RAW_MESSAGE_MISSING');
    return response.bytes;
  },

  uploadAttachment: async ({ accountId, filename, bytes }) => {
    const response = await transport.request({
      method: 'POST',
      path: `/api/accounts/${encodeURIComponent(accountId)}/messages/attachments`,
      query: { fileName: filename, isInline: 'false' },
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    const data = requireRecord(
      responseData(response.json, 'ZOHO_INVALID_ATTACHMENT_RESPONSE'),
      'ZOHO_INVALID_ATTACHMENT_RESPONSE',
    );
    if (
      typeof data.storeName !== 'string' ||
      typeof data.attachmentPath !== 'string' ||
      typeof data.attachmentName !== 'string'
    ) {
      throw new ZohoMailApiError('ZOHO_INVALID_ATTACHMENT_RESPONSE');
    }
    return {
      storeName: data.storeName,
      attachmentPath: data.attachmentPath,
      attachmentName: data.attachmentName,
    };
  },

  sendMessage: async ({ accountId, body }) => {
    const response = await transport.request({
      method: 'POST',
      path: `/api/accounts/${encodeURIComponent(accountId)}/messages`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseSendResult(response.json);
  },

  replyToMessage: async ({ accountId, parentMessageId, body }) => {
    const response = await transport.request({
      method: 'POST',
      path: `/api/accounts/${encodeURIComponent(accountId)}/messages/${encodeURIComponent(parentMessageId)}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseSendResult(response.json);
  },
});
