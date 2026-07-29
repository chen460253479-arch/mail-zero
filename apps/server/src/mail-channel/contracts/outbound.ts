export type OutboundEnvelope = {
  from: string;
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
};

export type FrozenOutboundMessage = {
  accountId: string;
  connectionId: string;
  submissionId: string;
  deliveryId: string;
  envelope: OutboundEnvelope;
  rawMime: Uint8Array;
  messageId: string;
  remoteThreadId: string | null;
  remoteParentMessageId?: string | null;
};

export type OutboundAcceptedResult = {
  remoteMessageId: string;
  remoteThreadId: string | null;
  acceptedAt: Date;
  providerCode: string | null;
  safeResponse: 'accepted';
};

export type OutboundReconciliationQuery = {
  accountId: string;
  connectionId: string;
  submissionId: string;
  deliveryId: string;
  messageId: string;
  remoteThreadId: string | null;
};

export type OutboundReconciliationResult =
  | { status: 'found'; result: OutboundAcceptedResult }
  | { status: 'not_found' }
  | { status: 'inconclusive'; retryAfter: Date | null };

export const outboundErrorKinds = [
  'rate_limited',
  'temporary_failure',
  'authentication_required',
  'quota_exceeded',
  'invalid_recipient',
  'policy_rejected',
  'payload_too_large',
  'uncertain',
  'permanent_failure',
] as const;

export type OutboundErrorKind = (typeof outboundErrorKinds)[number];
export type OutboundSafeResponse = Exclude<OutboundErrorKind, 'uncertain'> | 'unknown_result';

export type OutboundErrorClassification = {
  kind: OutboundErrorKind;
  providerCode: string | null;
  safeResponse: OutboundSafeResponse;
  retryAfter: Date | null;
};

export interface OutboundMailAdapter {
  readonly provider: string;
  send(input: FrozenOutboundMessage): Promise<OutboundAcceptedResult>;
  classifyError(error: unknown): OutboundErrorClassification;
  reconcile?(input: OutboundReconciliationQuery): Promise<OutboundReconciliationResult>;
}
