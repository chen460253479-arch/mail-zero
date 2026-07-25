const listTag = /^\[[^\]]+\]\s*/u;
const replyOrForwardPrefix = /^(?:re|fw|fwd)\s*:\s*/iu;

export function normalizeSubject(subject: string): string {
  let normalized = subject.normalize('NFC').trim();
  let previous: string;

  do {
    previous = normalized;
    normalized = normalized.replace(listTag, '').trimStart();
    normalized = normalized.replace(replyOrForwardPrefix, '').trimStart();
  } while (normalized !== previous);

  return normalized.replace(/\s+/gu, ' ').trim().toLowerCase();
}
