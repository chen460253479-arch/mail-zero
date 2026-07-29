import {
  MailSyncError,
  parseVersionedProviderState,
  type VersionedProviderState,
} from '../../../modules/mail-sync';

export type ZohoMailCheckpoint = {
  version: 1;
  accountId: string;
  inboxFolderId: string;
  receivedTime: string;
  messageId: string;
  baselineReceivedTime: string;
  lastSuccessfulAt: string;
};

export const parseZohoMailCheckpoint = (checkpoint: VersionedProviderState): ZohoMailCheckpoint => {
  const state = parseVersionedProviderState(checkpoint);
  const successfulAt =
    typeof state.lastSuccessfulAt === 'string' ? new Date(state.lastSuccessfulAt) : null;
  if (
    state.version !== 1 ||
    typeof state.accountId !== 'string' ||
    state.accountId.length === 0 ||
    typeof state.inboxFolderId !== 'string' ||
    state.inboxFolderId.length === 0 ||
    typeof state.receivedTime !== 'string' ||
    !/^\d+$/u.test(state.receivedTime) ||
    typeof state.messageId !== 'string' ||
    typeof state.baselineReceivedTime !== 'string' ||
    !/^\d+$/u.test(state.baselineReceivedTime) ||
    successfulAt === null ||
    Number.isNaN(successfulAt.getTime())
  ) {
    throw new MailSyncError('ZOHO_INVALID_CHECKPOINT', 'permanent');
  }
  return {
    version: 1,
    accountId: state.accountId,
    inboxFolderId: state.inboxFolderId,
    receivedTime: state.receivedTime,
    messageId: state.messageId,
    baselineReceivedTime: state.baselineReceivedTime,
    lastSuccessfulAt: successfulAt.toISOString(),
  };
};

export const createZohoMailCheckpoint = (
  input: Omit<ZohoMailCheckpoint, 'version' | 'lastSuccessfulAt'> & {
    lastSuccessfulAt: Date;
  },
): ZohoMailCheckpoint =>
  parseZohoMailCheckpoint({
    version: 1,
    accountId: input.accountId,
    inboxFolderId: input.inboxFolderId,
    receivedTime: input.receivedTime,
    messageId: input.messageId,
    baselineReceivedTime: input.baselineReceivedTime,
    lastSuccessfulAt: input.lastSuccessfulAt.toISOString(),
  });
