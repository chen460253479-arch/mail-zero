import type { ResolvedCredential } from '../../../mail-channel/contracts';

export type MailOutboundCommand =
  | { type: 'dispatch' }
  | { type: 'deliver'; deliveryId: string }
  | { type: 'reconcile'; deliveryId: string };

export interface OutboundWakeupPort {
  enqueue(command: MailOutboundCommand): Promise<void>;
}

export interface OutboundCredentialResolver {
  resolve(connectionId: string): Promise<ResolvedCredential>;
}

export interface OutboundConnectionStatePort {
  markAuthenticationRequired(connectionId: string): Promise<void>;
}
