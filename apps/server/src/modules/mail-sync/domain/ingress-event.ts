import type { VersionedProviderState } from './sync-state';

export type IngressMessageAdded = {
  type: 'message_added';
  remoteMessageId: string;
  remoteThreadId: string | null;
};

export type DiscoverPage = {
  events: IngressMessageAdded[];
  nextPageToken: string | null;
  checkpoint: VersionedProviderState;
};

export type RawIngressMessage = {
  remoteMessageId: string;
  raw: Uint8Array;
  receivedAt: Date | null;
};
