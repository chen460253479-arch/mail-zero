export type ChannelPushEvent = {
  mailbox: string;
  cursor: string;
};

export type ChannelChange = {
  remoteMessageId: string;
  remoteThreadId: string;
  addedLabelIds: string[];
  removedLabelIds: string[];
  deleted: boolean;
};

export type ChannelChangeSet = {
  changes: ChannelChange[];
  nextCursor: string;
};

export interface ChannelSyncAdapter {
  parsePushEvent(payload: unknown): ChannelPushEvent;
}
