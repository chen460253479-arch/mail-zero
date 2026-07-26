import type { EmailId, MailboxId, ThreadId } from '../types';

export type EmailAggregateProjection = {
  emailId: EmailId;
  threadId: ThreadId;
  mailboxIds: MailboxId[];
  visible: boolean;
  unread: boolean;
  hasAttachment: boolean;
  receivedAt: Date;
};

export type AggregateCounterDelta<Key extends object> = Key & {
  emailDelta: number;
  unreadDelta: number;
};

export type EmailAggregateDelta = {
  threadDeltas: AggregateCounterDelta<{ threadId: ThreadId }>[];
  mailboxDeltas: AggregateCounterDelta<{ mailboxId: MailboxId }>[];
  mailboxThreadDeltas: AggregateCounterDelta<{
    mailboxId: MailboxId;
    threadId: ThreadId;
  }>[];
};

type Counter = { emailDelta: number; unreadDelta: number };

const add = (map: Map<string, Counter>, key: string, emailDelta: number, unreadDelta: number) => {
  const current = map.get(key) ?? { emailDelta: 0, unreadDelta: 0 };
  map.set(key, {
    emailDelta: current.emailDelta + emailDelta,
    unreadDelta: current.unreadDelta + unreadDelta,
  });
};

const active = (projection: EmailAggregateProjection | null): EmailAggregateProjection | null =>
  projection !== null && projection.visible && projection.mailboxIds.length > 0 ? projection : null;

export function calculateEmailAggregateDelta(
  beforeInput: EmailAggregateProjection | null,
  afterInput: EmailAggregateProjection | null,
): EmailAggregateDelta {
  const before = active(beforeInput);
  const after = active(afterInput);
  const threads = new Map<string, Counter>();
  const mailboxes = new Map<string, Counter>();
  const mailboxThreads = new Map<string, Counter>();
  const apply = (projection: EmailAggregateProjection, direction: -1 | 1) => {
    const unreadDelta = projection.unread ? direction : 0;
    add(threads, projection.threadId, direction, unreadDelta);
    for (const mailboxId of new Set(projection.mailboxIds)) {
      add(mailboxes, mailboxId, direction, unreadDelta);
      add(mailboxThreads, `${mailboxId}\u0000${projection.threadId}`, direction, unreadDelta);
    }
  };
  if (before !== null) apply(before, -1);
  if (after !== null) apply(after, 1);
  const nonzero = ([, value]: [string, Counter]) =>
    value.emailDelta !== 0 || value.unreadDelta !== 0;
  return {
    threadDeltas: [...threads]
      .filter(nonzero)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([threadId, delta]) => ({ threadId: threadId as ThreadId, ...delta })),
    mailboxDeltas: [...mailboxes]
      .filter(nonzero)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([mailboxId, delta]) => ({ mailboxId: mailboxId as MailboxId, ...delta })),
    mailboxThreadDeltas: [...mailboxThreads]
      .filter(nonzero)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, delta]) => {
        const [mailboxId, threadId] = key.split('\u0000') as [MailboxId, ThreadId];
        return { mailboxId, threadId, ...delta };
      }),
  };
}
