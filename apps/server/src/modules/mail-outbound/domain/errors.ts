export const mailOutboundErrorCodes = [
  'DELIVERY_NOT_FOUND',
  'INVALID_DELIVERY_TRANSITION',
  'MAIL_OUTBOUND_LEASE_LOST',
  'MAIL_OUTBOUND_STORAGE_FAILURE',
] as const;

export type MailOutboundErrorCode = (typeof mailOutboundErrorCodes)[number];
export type MailOutboundErrorDisposition = 'transient' | 'permanent' | 'uncertain';

export class MailOutboundError extends Error {
  constructor(
    public readonly code: MailOutboundErrorCode,
    public readonly disposition: MailOutboundErrorDisposition,
    public readonly entityId?: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'MailOutboundError';
  }
}
