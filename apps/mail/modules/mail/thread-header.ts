import type { Label, ParsedMessage } from '@/types';

export type ThreadHeader = {
  subject: string;
  labels: Label[];
};

export function buildThreadHeader(messages: readonly ParsedMessage[]): ThreadHeader {
  const subject = messages.find((message) => message.subject.trim())?.subject.trim() ?? '';
  const labels = Array.from(
    new Map(
      messages
        .flatMap((message) => message.tags)
        .map((label) => [`${label.type}:${label.id}`, label] as const),
    ).values(),
  );

  return { subject, labels };
}
