import {
  MailSyncError,
  parseVersionedProviderState,
  type VersionedProviderState,
} from '../../../modules/mail-sync';

export type ImapCheckpoint = {
  version: 1;
  mailbox: 'INBOX';
  uidValidity: string;
  nextUid: number;
  highestModseq: string | null;
  lastSuccessfulAt: string;
};

const positiveIntegerText = /^[1-9]\d*$/u;

export const parseImapCheckpoint = (value: VersionedProviderState): ImapCheckpoint => {
  const state = parseVersionedProviderState(value);
  const lastSuccessfulAt =
    typeof state.lastSuccessfulAt === 'string'
      ? new Date(state.lastSuccessfulAt)
      : new Date(Number.NaN);
  if (
    state.version !== 1 ||
    state.mailbox !== 'INBOX' ||
    typeof state.uidValidity !== 'string' ||
    !positiveIntegerText.test(state.uidValidity) ||
    typeof state.nextUid !== 'number' ||
    !Number.isSafeInteger(state.nextUid) ||
    state.nextUid < 1 ||
    state.nextUid > 0xffff_ffff ||
    (state.highestModseq !== null &&
      (typeof state.highestModseq !== 'string' ||
        !positiveIntegerText.test(state.highestModseq))) ||
    Number.isNaN(lastSuccessfulAt.getTime())
  ) {
    throw new MailSyncError('IMAP_INVALID_CHECKPOINT', 'permanent');
  }
  return {
    version: 1,
    mailbox: 'INBOX',
    uidValidity: state.uidValidity,
    nextUid: state.nextUid,
    highestModseq: state.highestModseq,
    lastSuccessfulAt: lastSuccessfulAt.toISOString(),
  };
};

export const createImapCheckpoint = (input: {
  uidValidity: string;
  nextUid: number;
  highestModseq: string | null;
  lastSuccessfulAt: Date;
}): ImapCheckpoint =>
  parseImapCheckpoint({
    version: 1,
    mailbox: 'INBOX',
    uidValidity: input.uidValidity,
    nextUid: input.nextUid,
    highestModseq: input.highestModseq,
    lastSuccessfulAt: input.lastSuccessfulAt.toISOString(),
  });

export const toImapRemoteMessageId = (uidValidity: string, uid: number): string => {
  const result = `${uidValidity}:${uid}`;
  parseImapRemoteMessageId(result);
  return result;
};

export const parseImapRemoteMessageId = (value: string): { uidValidity: string; uid: number } => {
  const match = /^([1-9]\d*):([1-9]\d*)$/u.exec(value);
  const uid = Number(match?.[2]);
  if (match === null || !Number.isSafeInteger(uid) || uid < 1 || uid > 0xffff_ffff) {
    throw new MailSyncError('IMAP_INVALID_REMOTE_MESSAGE_ID', 'permanent');
  }
  return { uidValidity: match[1]!, uid };
};
