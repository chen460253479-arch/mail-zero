export type ExternalIntegrationErrorCode =
  | 'MESSAGE_NOT_FOUND'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ACTIVE_MAILBOX_NOT_FOUND'
  | 'EXTERNAL_USER_INVALID'
  | 'EXTERNAL_USER_NOT_FOUND'
  | 'NANGO_CONNECTION_NOT_BOUND'
  | 'LAUNCH_CODE_INVALID'
  | 'EXTERNAL_SESSION_INVALID'
  | 'EXTERNAL_SESSION_SCOPE_NOT_FOUND';

export class ExternalIntegrationError extends Error {
  constructor(public readonly code: ExternalIntegrationErrorCode) {
    super(code);
    this.name = 'ExternalIntegrationError';
  }
}
