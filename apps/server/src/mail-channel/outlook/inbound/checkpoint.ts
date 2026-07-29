import {
  MailSyncError,
  parseVersionedProviderState,
  type VersionedProviderState,
} from '../../../modules/mail-sync';

export type OutlookCheckpoint = {
  version: 1;
  inboxFolderId: 'inbox';
  cursorUrl: string;
  lastSuccessfulAt: string;
};

const isTrustedDeltaUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://graph.microsoft.com' &&
      url.pathname.startsWith('/v1.0/me/mailFolders/inbox/messages/delta')
    );
  } catch {
    return false;
  }
};

export const parseOutlookCheckpoint = (checkpoint: VersionedProviderState): OutlookCheckpoint => {
  const state = parseVersionedProviderState(checkpoint);
  const lastSuccessfulAt =
    typeof state.lastSuccessfulAt === 'string' ? new Date(state.lastSuccessfulAt) : null;
  if (
    state.version !== 1 ||
    state.inboxFolderId !== 'inbox' ||
    typeof state.cursorUrl !== 'string' ||
    !isTrustedDeltaUrl(state.cursorUrl) ||
    lastSuccessfulAt === null ||
    Number.isNaN(lastSuccessfulAt.getTime())
  ) {
    throw new MailSyncError('OUTLOOK_INVALID_CHECKPOINT', 'permanent');
  }
  return {
    version: 1,
    inboxFolderId: 'inbox',
    cursorUrl: state.cursorUrl,
    lastSuccessfulAt: lastSuccessfulAt.toISOString(),
  };
};

export const createOutlookCheckpoint = (input: {
  cursorUrl: string;
  lastSuccessfulAt: Date;
}): OutlookCheckpoint =>
  parseOutlookCheckpoint({
    version: 1,
    inboxFolderId: 'inbox',
    cursorUrl: input.cursorUrl,
    lastSuccessfulAt: input.lastSuccessfulAt.toISOString(),
  });
