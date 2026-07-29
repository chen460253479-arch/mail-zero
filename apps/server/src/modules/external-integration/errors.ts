export type ExternalIntegrationErrorCode = 'MESSAGE_NOT_FOUND' | 'ATTACHMENT_NOT_FOUND';

export class ExternalIntegrationError extends Error {
  constructor(public readonly code: ExternalIntegrationErrorCode) {
    super(code);
    this.name = 'ExternalIntegrationError';
  }
}
