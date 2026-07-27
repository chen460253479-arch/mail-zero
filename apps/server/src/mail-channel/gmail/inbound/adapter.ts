import { toByteArray } from 'base64-js';

import {
  createInboundMailAdapterFactory,
  MailSyncError,
  parseIngressScope,
  parseVersionedProviderState,
  type InboundMailAdapter,
  type InboundMailAdapterFactory,
  type VersionedProviderState,
} from '../../../modules/mail-sync';
import { classifyGmailError, gmailErrorStatus } from '../shared/errors';
import type { GmailApiClient } from '../shared/api-client';
import { mapGmailHistoryPage } from './history-mapper';

type GmailCheckpoint = {
  version: 1;
  historyId: string;
};

const parseGmailCheckpoint = (checkpoint: VersionedProviderState): GmailCheckpoint => {
  const state = parseVersionedProviderState(checkpoint);
  if (state.version !== 1 || typeof state.historyId !== 'string' || state.historyId.length === 0) {
    throw new MailSyncError('GMAIL_INVALID_CHECKPOINT', 'permanent');
  }
  return { version: 1, historyId: state.historyId };
};

const parseTopicName = (target: VersionedProviderState): string => {
  const state = parseVersionedProviderState(target);
  if (state.version !== 1 || typeof state.topicName !== 'string' || state.topicName.length === 0) {
    throw new MailSyncError('GMAIL_INVALID_SUBSCRIPTION_TARGET', 'permanent');
  }
  return state.topicName;
};

const decodeBase64Url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    throw new MailSyncError('GMAIL_INVALID_RAW_MESSAGE', 'permanent');
  }
  const standard = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), '=');
  try {
    return toByteArray(padded);
  } catch (error) {
    throw new MailSyncError('GMAIL_INVALID_RAW_MESSAGE', 'permanent', {
      cause: error,
    });
  }
};

const parseInternalDate = (value: string | null): Date | null => {
  if (value === null || !/^\d+$/u.test(value)) {
    return null;
  }
  const receivedAt = new Date(Number(value));
  return Number.isNaN(receivedAt.getTime()) ? null : receivedAt;
};

export const createGmailIngressAdapter = (client: GmailApiClient): InboundMailAdapter => ({
  provider: 'gmail',

  establishCheckpoint: async (scope) => {
    parseIngressScope(scope);
    const profile = await client.getProfile();
    if (!profile.historyId) {
      throw new MailSyncError('GMAIL_PROFILE_HISTORY_ID_MISSING', 'permanent');
    }
    return {
      version: 1,
      historyId: profile.historyId,
    };
  },

  discover: async ({ scope, checkpoint, pageToken }) => {
    parseIngressScope(scope);
    const gmailCheckpoint = parseGmailCheckpoint(checkpoint);
    try {
      const page = await client.listHistory({
        startHistoryId: gmailCheckpoint.historyId,
        pageToken,
      });
      const finalHistoryId = page.historyId ?? gmailCheckpoint.historyId;
      return {
        events: mapGmailHistoryPage(page.history),
        nextPageToken: page.nextPageToken,
        checkpoint:
          page.nextPageToken === null ? { version: 1, historyId: finalHistoryId } : gmailCheckpoint,
      };
    } catch (error) {
      if (gmailErrorStatus(error) === 404) {
        throw new MailSyncError('GMAIL_HISTORY_GAP', 'permanent', {
          cause: error,
        });
      }
      throw error;
    }
  },

  fetchRawMessage: async ({ scope, remoteMessageId }) => {
    parseIngressScope(scope);
    const message = await client.getRawMessage(remoteMessageId);
    if (message.raw === null) {
      throw new MailSyncError('GMAIL_RAW_MESSAGE_MISSING', 'permanent');
    }
    return {
      remoteMessageId,
      raw: decodeBase64Url(message.raw),
      receivedAt: parseInternalDate(message.internalDate),
    };
  },

  subscribe: async ({ scope, checkpoint, target }) => {
    parseIngressScope(scope);
    parseGmailCheckpoint(checkpoint);
    const subscription = await client.watchInbox(parseTopicName(target));
    const expiresAt = parseInternalDate(subscription.expiration);
    if (expiresAt === null) {
      throw new MailSyncError('GMAIL_WATCH_EXPIRATION_MISSING', 'retryable');
    }
    return {
      expiresAt,
    };
  },

  unsubscribe: async () => {
    await client.stopWatch();
  },

  classifyError: classifyGmailError,
});

export const createGmailInboundAdapterFactory = (
  createClient: (connectionId: string) => Promise<GmailApiClient>,
): InboundMailAdapterFactory =>
  createInboundMailAdapterFactory(async (connectionId) =>
    createGmailIngressAdapter(await createClient(connectionId)),
  );
