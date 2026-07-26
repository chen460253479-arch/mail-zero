import { Buffer } from 'node:buffer';

export const GMAIL_JSON_SEND_RAW_LIMIT = 3_500_000;

export type GmailJsonSendRequest = {
  mode: 'json';
  requestBody: {
    raw: string;
    threadId?: string;
  };
};

export type GmailUploadSendRequest = {
  mode: 'upload';
  requestBody: {
    threadId?: string;
  };
  media: {
    mimeType: 'message/rfc822';
    body: Uint8Array;
  };
};

export type GmailSendRequest = GmailJsonSendRequest | GmailUploadSendRequest;

export const buildGmailSendRequest = (
  raw: Uint8Array,
  remoteThreadId: string | null,
): GmailSendRequest =>
  raw.byteLength <= GMAIL_JSON_SEND_RAW_LIMIT
    ? {
        mode: 'json',
        requestBody: {
          raw: Buffer.from(raw).toString('base64url'),
          ...(remoteThreadId === null ? {} : { threadId: remoteThreadId }),
        },
      }
    : {
        mode: 'upload',
        requestBody: remoteThreadId === null ? {} : { threadId: remoteThreadId },
        media: {
          mimeType: 'message/rfc822',
          body: raw,
        },
      };
