import type { EmailRecord, MailTransaction } from '../store';
import type { EmailAggregateProjection } from '../mailbox';
import type { PendingMailChange } from '../changes';
import type { MailAccountId } from '../types';

export const emailAggregateProjection = (email: EmailRecord): EmailAggregateProjection => ({
  emailId: email.id,
  threadId: email.threadId,
  mailboxIds: email.mailboxIds,
  visible: email.destroyedAt === null && email.mailboxIds.length > 0,
  unread: !email.keywords.includes('$seen'),
  hasAttachment: email.hasAttachment,
  receivedAt: email.receivedAt,
});

export async function applyEmailAggregateDelta(
  tx: MailTransaction,
  input: {
    accountId: MailAccountId;
    before: EmailRecord | null;
    after: EmailRecord | null;
    now: Date;
  },
): Promise<PendingMailChange[]> {
  const result = await tx.mailAggregates.applyEmailDelta({
    accountId: input.accountId,
    before: input.before === null ? null : emailAggregateProjection(input.before),
    after: input.after === null ? null : emailAggregateProjection(input.after),
    now: input.now,
  });
  return [
    ...result.threadChanges
      .filter(({ changedProperties }) => changedProperties.length > 0)
      .map(({ threadId, changedProperties }) => ({
        collection: 'thread' as const,
        entityId: threadId,
        changeType: 'updated' as const,
        changedProperties,
      })),
    ...result.mailboxChanges
      .filter(({ changedProperties }) => changedProperties.length > 0)
      .map(({ mailboxId, changedProperties }) => ({
        collection: 'mailbox' as const,
        entityId: mailboxId,
        changeType: 'updated' as const,
        changedProperties,
      })),
  ];
}
