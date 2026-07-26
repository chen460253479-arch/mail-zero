import type { MailIngressCommand } from '../../../modules/mail-sync/application/commands';

const parseGmailPush = (payload: unknown): { emailAddress: string; historyId: string } | null => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.emailAddress !== 'string' || typeof record.historyId !== 'string') {
    return null;
  }
  const emailAddress = record.emailAddress.trim().toLocaleLowerCase('und');
  const historyId = record.historyId.trim();
  if (!/^[^@\s]+@[^@\s]+$/u.test(emailAddress) || historyId.length === 0) {
    return null;
  }
  return { emailAddress, historyId };
};

export const handleGmailPush = async (
  payload: unknown,
  dependencies: {
    enqueue(command: MailIngressCommand): Promise<void>;
  },
): Promise<{ accepted: boolean }> => {
  const notification = parseGmailPush(payload);
  if (notification === null) {
    return { accepted: false };
  }
  await dependencies.enqueue({
    type: 'signal',
    provider: 'gmail',
    externalAccount: notification.emailAddress,
    cursorHint: notification.historyId,
  });
  return { accepted: true };
};
