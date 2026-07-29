import {
  parseIngressScope,
  parseVersionedProviderState,
  type IngressScope,
  type VersionedProviderState,
} from './sync-state';
import type { DiscoverPage, RawIngressMessage } from './ingress-event';
import type { MailSyncErrorClassification } from './errors';

export type InboundSubscriptionState = {
  expiresAt: Date | null;
  externalId?: string | null;
  endpointTokenHash?: string | null;
  encryptedSecret?: string | null;
  establishedAt?: Date | null;
};

export interface InboundMailAdapter {
  readonly provider: string;
  establishCheckpoint(scope: IngressScope): Promise<VersionedProviderState>;
  discover(input: {
    scope: IngressScope;
    checkpoint: VersionedProviderState;
    pageToken: string | null;
  }): Promise<DiscoverPage>;
  fetchRawMessage(input: {
    scope: IngressScope;
    remoteMessageId: string;
  }): Promise<RawIngressMessage>;
  subscribe?(input: {
    scope: IngressScope;
    checkpoint: VersionedProviderState;
    target: VersionedProviderState;
    currentSubscription?: InboundSubscriptionState;
  }): Promise<InboundSubscriptionState>;
  unsubscribe?(): Promise<void>;
  classifyError(error: unknown): MailSyncErrorClassification;
}

export interface InboundMailAdapterFactory {
  create(connectionId: string): Promise<InboundMailAdapter>;
}

export const createInboundMailAdapterFactory = (
  create: (connectionId: string) => Promise<InboundMailAdapter>,
): InboundMailAdapterFactory => ({ create });

export { parseIngressScope, parseVersionedProviderState };
export type { IngressScope, VersionedProviderState };
