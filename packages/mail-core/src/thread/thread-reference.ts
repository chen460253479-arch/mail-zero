import { MailCoreError } from '../types';
import { normalizeSubject } from './normalize-subject';
import { normalizeMessageId } from './thread-keys';

export type ThreadReferenceKey = {
  normalizedSubjectHash: string;
  messageIdHash: string;
};

const encoder = new TextEncoder();

export async function hashThreadKey(value: string): Promise<string> {
  const platformCrypto = (
    globalThis as unknown as {
      crypto?: {
        subtle: {
          digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
        };
      };
    }
  ).crypto;
  if (platformCrypto === undefined) {
    throw new MailCoreError('STORAGE_FAILURE');
  }
  const digest = await platformCrypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createThreadReferenceKeys(input: {
  subject: string;
  messageIds: string[];
}): Promise<ThreadReferenceKey[]> {
  const normalizedMessageIds = [
    ...new Set(input.messageIds.map(normalizeMessageId).filter((messageId) => messageId.length > 0)),
  ];
  if (normalizedMessageIds.length === 0) {
    return [];
  }
  const normalizedSubjectHash = await hashThreadKey(normalizeSubject(input.subject));
  const keys = await Promise.all(
    normalizedMessageIds.map(async (messageId) => ({
      normalizedSubjectHash,
      messageIdHash: await hashThreadKey(messageId),
    })),
  );
  return keys.sort((left, right) => left.messageIdHash.localeCompare(right.messageIdHash));
}
