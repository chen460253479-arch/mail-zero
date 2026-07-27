import { toByteArray } from 'base64-js';

type GmailSignal = {
  provider: 'gmail';
  externalAccount: string;
  cursorHint: string;
};

const unwrapPubSubPayload = (payload: unknown): unknown => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const message = (payload as Record<string, unknown>).message;
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return payload;
  }
  const data = (message as Record<string, unknown>).data;
  if (typeof data !== 'string' || data.length === 0) {
    return payload;
  }
  try {
    return JSON.parse(new TextDecoder().decode(toByteArray(data))) as unknown;
  } catch {
    return null;
  }
};

const parseGmailPush = (payload: unknown): { emailAddress: string; historyId: string } | null => {
  payload = unwrapPubSubPayload(payload);
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
    recordSignal(signal: GmailSignal): Promise<string[]>;
    enqueueDiscover(syncId: string): Promise<void>;
  },
): Promise<{ accepted: boolean; matched: number; queued: number }> => {
  const notification = parseGmailPush(payload);
  if (notification === null) {
    return { accepted: false, matched: 0, queued: 0 };
  }
  const syncIds = await dependencies.recordSignal({
    provider: 'gmail',
    externalAccount: notification.emailAddress,
    cursorHint: notification.historyId,
  });
  const wakeups = await Promise.allSettled(
    syncIds.map((syncId) => dependencies.enqueueDiscover(syncId)),
  );
  return {
    accepted: true,
    matched: syncIds.length,
    queued: wakeups.filter(({ status }) => status === 'fulfilled').length,
  };
};
