import { MailSyncError } from '../domain/errors';

export type MailIngressCommand =
  | {
      type: 'signal';
      provider: string;
      externalAccount: string;
      cursorHint?: string;
    }
  | { type: 'discover'; syncId: string }
  | { type: 'import'; syncId: string }
  | { type: 'reconcile'; syncId: string }
  | { type: 'renew'; syncId: string };

export const parseMailIngressCommand = (value: unknown): MailIngressCommand => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MailSyncError('MAIL_SYNC_INVALID_COMMAND', 'permanent');
  }
  const command = value as Record<string, unknown>;
  if (
    command.type === 'signal' &&
    typeof command.provider === 'string' &&
    command.provider.length > 0 &&
    typeof command.externalAccount === 'string' &&
    command.externalAccount.length > 0 &&
    (command.cursorHint === undefined || typeof command.cursorHint === 'string')
  ) {
    return {
      type: 'signal',
      provider: command.provider,
      externalAccount: command.externalAccount,
      ...(command.cursorHint === undefined ? {} : { cursorHint: command.cursorHint as string }),
    };
  }
  if (
    ['discover', 'import', 'reconcile', 'renew'].includes(String(command.type)) &&
    typeof command.syncId === 'string' &&
    command.syncId.length > 0
  ) {
    return {
      type: command.type as 'discover' | 'import' | 'reconcile' | 'renew',
      syncId: command.syncId,
    };
  }
  throw new MailSyncError('MAIL_SYNC_INVALID_COMMAND', 'permanent');
};
