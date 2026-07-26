import { describe, expect, it } from 'vitest';

import {
  calculateEmailAggregateDelta,
  type EmailAggregateProjection,
  type EmailId,
  type MailboxId,
  type ThreadId,
} from '../../src';

const projection = (
  overrides: Partial<EmailAggregateProjection> = {},
): EmailAggregateProjection => ({
  emailId: 'email-1' as EmailId,
  threadId: 'thread-a' as ThreadId,
  mailboxIds: ['mailbox-a' as MailboxId],
  visible: true,
  unread: true,
  hasAttachment: false,
  receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('calculateEmailAggregateDelta', () => {
  it('produces creation and visibility-removal deltas only for affected keys', () => {
    const created = calculateEmailAggregateDelta(null, projection());
    expect(created.threadDeltas).toEqual([{ threadId: 'thread-a', emailDelta: 1, unreadDelta: 1 }]);
    expect(created.mailboxDeltas).toEqual([
      { mailboxId: 'mailbox-a', emailDelta: 1, unreadDelta: 1 },
    ]);
    expect(created.mailboxThreadDeltas).toEqual([
      {
        mailboxId: 'mailbox-a',
        threadId: 'thread-a',
        emailDelta: 1,
        unreadDelta: 1,
      },
    ]);

    expect(calculateEmailAggregateDelta(projection(), null)).toEqual({
      threadDeltas: [{ threadId: 'thread-a', emailDelta: -1, unreadDelta: -1 }],
      mailboxDeltas: [{ mailboxId: 'mailbox-a', emailDelta: -1, unreadDelta: -1 }],
      mailboxThreadDeltas: [
        {
          mailboxId: 'mailbox-a',
          threadId: 'thread-a',
          emailDelta: -1,
          unreadDelta: -1,
        },
      ],
    });
  });

  it('handles Mailbox moves, read changes, and Thread changes independently', () => {
    const moved = calculateEmailAggregateDelta(
      projection(),
      projection({ mailboxIds: ['mailbox-b' as MailboxId] }),
    );
    expect(moved.threadDeltas).toEqual([]);
    expect(moved.mailboxDeltas).toEqual([
      { mailboxId: 'mailbox-a', emailDelta: -1, unreadDelta: -1 },
      { mailboxId: 'mailbox-b', emailDelta: 1, unreadDelta: 1 },
    ]);

    const read = calculateEmailAggregateDelta(projection(), projection({ unread: false }));
    expect(read.threadDeltas).toEqual([{ threadId: 'thread-a', emailDelta: 0, unreadDelta: -1 }]);
    expect(read.mailboxDeltas).toEqual([
      { mailboxId: 'mailbox-a', emailDelta: 0, unreadDelta: -1 },
    ]);

    const rethreaded = calculateEmailAggregateDelta(
      projection(),
      projection({ threadId: 'thread-b' as ThreadId }),
    );
    expect(rethreaded.threadDeltas).toEqual([
      { threadId: 'thread-a', emailDelta: -1, unreadDelta: -1 },
      { threadId: 'thread-b', emailDelta: 1, unreadDelta: 1 },
    ]);
    expect(rethreaded.mailboxDeltas).toEqual([]);
    expect(rethreaded.mailboxThreadDeltas).toEqual([
      {
        mailboxId: 'mailbox-a',
        threadId: 'thread-a',
        emailDelta: -1,
        unreadDelta: -1,
      },
      {
        mailboxId: 'mailbox-a',
        threadId: 'thread-b',
        emailDelta: 1,
        unreadDelta: 1,
      },
    ]);
  });
});
