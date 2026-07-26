import type { MailAggregateRepository, MailboxId, ThreadId } from '@zero/mail-core';
import { and, asc, desc, eq, exists, inArray, isNull } from 'drizzle-orm';
import { calculateEmailAggregateDelta } from '@zero/mail-core';

import { email, emailAddress, emailMailbox, mailbox, mailboxThread, thread } from '../schema';
import { requireRow, runAdapter, type MailDatabase } from './database';

const different = (left: unknown, right: unknown): boolean =>
  left instanceof Date && right instanceof Date
    ? left.getTime() !== right.getTime()
    : !Object.is(left, right);

export const createMailAggregateRepository = (db: MailDatabase): MailAggregateRepository => ({
  applyEmailDelta: (input) =>
    runAdapter(async () => {
      const delta = calculateEmailAggregateDelta(input.before, input.after);
      const threadChanges: { threadId: ThreadId; changedProperties: string[] }[] = [];
      for (const change of delta.threadDeltas) {
        const current = requireRow(
          await db
            .select()
            .from(thread)
            .where(and(eq(thread.mailAccountId, input.accountId), eq(thread.id, change.threadId)))
            .limit(1),
          'THREAD_NOT_FOUND',
          change.threadId,
        );
        const visibleMembership = exists(
          db
            .select({ emailId: emailMailbox.emailId })
            .from(emailMailbox)
            .where(
              and(
                eq(emailMailbox.mailAccountId, email.mailAccountId),
                eq(emailMailbox.emailId, email.id),
              ),
            ),
        );
        const latestRows = await db
          .select({
            id: email.id,
            receivedAt: email.receivedAt,
            preview: email.preview,
          })
          .from(email)
          .where(
            and(
              eq(email.mailAccountId, input.accountId),
              eq(email.threadId, change.threadId),
              isNull(email.destroyedAt),
              visibleMembership,
            ),
          )
          .orderBy(desc(email.receivedAt), desc(email.id))
          .limit(1);
        const latest = latestRows[0];
        const attachmentRows = await db
          .select({ id: email.id })
          .from(email)
          .where(
            and(
              eq(email.mailAccountId, input.accountId),
              eq(email.threadId, change.threadId),
              eq(email.hasAttachment, true),
              isNull(email.destroyedAt),
              visibleMembership,
            ),
          )
          .limit(1);
        const participants =
          latest === undefined
            ? []
            : await db
                .select({
                  name: emailAddress.name,
                  address: emailAddress.address,
                })
                .from(emailAddress)
                .where(
                  and(
                    eq(emailAddress.mailAccountId, input.accountId),
                    eq(emailAddress.emailId, latest.id),
                    inArray(emailAddress.kind, ['from', 'to', 'cc']),
                  ),
                )
                .orderBy(asc(emailAddress.kind), asc(emailAddress.position));
        const participantSummary =
          participants.length === 0
            ? null
            : [...new Set(participants.map(({ name, address }) => name?.trim() || address))]
                .slice(0, 3)
                .join(', ');
        const next = {
          latestReceivedAt: latest?.receivedAt ?? current.latestReceivedAt,
          emailCount: current.emailCount + change.emailDelta,
          unreadCount: current.unreadCount + change.unreadDelta,
          hasAttachment: attachmentRows.length > 0,
          participantSummary,
          preview: latest?.preview ?? null,
        };
        if (next.emailCount < 0 || next.unreadCount < 0 || next.unreadCount > next.emailCount) {
          throw new Error('invalid Thread aggregate delta');
        }
        const keys = [
          'latestReceivedAt',
          'emailCount',
          'unreadCount',
          'hasAttachment',
          'participantSummary',
          'preview',
        ] as const;
        await db
          .update(thread)
          .set({ ...next, updatedAt: input.now })
          .where(and(eq(thread.mailAccountId, input.accountId), eq(thread.id, change.threadId)));
        threadChanges.push({
          threadId: change.threadId,
          changedProperties: keys.filter((key) => different(current[key], next[key])),
        });
      }

      type MailboxRow = typeof mailbox.$inferSelect;
      const currentMailboxes = new Map<MailboxId, { before: MailboxRow; after: MailboxRow }>();
      const requireMailbox = async (mailboxId: MailboxId) => {
        const existing = currentMailboxes.get(mailboxId);
        if (existing !== undefined) return existing;
        const row = requireRow(
          await db
            .select()
            .from(mailbox)
            .where(and(eq(mailbox.mailAccountId, input.accountId), eq(mailbox.id, mailboxId)))
            .limit(1),
          'MAILBOX_NOT_FOUND',
          mailboxId,
        );
        const tracked = { before: row, after: { ...row } };
        currentMailboxes.set(mailboxId, tracked);
        return tracked;
      };
      for (const change of delta.mailboxDeltas) {
        const tracked = await requireMailbox(change.mailboxId);
        tracked.after.totalEmails += change.emailDelta;
        tracked.after.unreadEmails += change.unreadDelta;
      }
      for (const change of delta.mailboxThreadDeltas) {
        const rows = await db
          .select()
          .from(mailboxThread)
          .where(
            and(
              eq(mailboxThread.mailAccountId, input.accountId),
              eq(mailboxThread.mailboxId, change.mailboxId),
              eq(mailboxThread.threadId, change.threadId),
            ),
          )
          .limit(1);
        const current = rows[0] ?? {
          mailAccountId: input.accountId,
          mailboxId: change.mailboxId,
          threadId: change.threadId,
          emailCount: 0,
          unreadCount: 0,
        };
        const next = {
          emailCount: current.emailCount + change.emailDelta,
          unreadCount: current.unreadCount + change.unreadDelta,
        };
        if (next.emailCount < 0 || next.unreadCount < 0 || next.unreadCount > next.emailCount) {
          throw new Error('invalid Mailbox Thread aggregate delta');
        }
        const tracked = await requireMailbox(change.mailboxId);
        if (current.emailCount === 0 && next.emailCount > 0) tracked.after.totalThreads += 1;
        if (current.emailCount > 0 && next.emailCount === 0) tracked.after.totalThreads -= 1;
        if (current.unreadCount === 0 && next.unreadCount > 0) tracked.after.unreadThreads += 1;
        if (current.unreadCount > 0 && next.unreadCount === 0) tracked.after.unreadThreads -= 1;
        if (next.emailCount === 0) {
          await db
            .delete(mailboxThread)
            .where(
              and(
                eq(mailboxThread.mailAccountId, input.accountId),
                eq(mailboxThread.mailboxId, change.mailboxId),
                eq(mailboxThread.threadId, change.threadId),
              ),
            );
        } else if (rows.length === 0) {
          await db.insert(mailboxThread).values({
            mailAccountId: input.accountId,
            mailboxId: change.mailboxId,
            threadId: change.threadId,
            ...next,
          });
        } else {
          await db
            .update(mailboxThread)
            .set(next)
            .where(
              and(
                eq(mailboxThread.mailAccountId, input.accountId),
                eq(mailboxThread.mailboxId, change.mailboxId),
                eq(mailboxThread.threadId, change.threadId),
              ),
            );
        }
      }
      const mailboxChanges: {
        mailboxId: MailboxId;
        changedProperties: string[];
      }[] = [];
      for (const [mailboxId, tracked] of currentMailboxes) {
        const keys = ['totalEmails', 'unreadEmails', 'totalThreads', 'unreadThreads'] as const;
        if (
          keys.some((key) => tracked.after[key] < 0) ||
          tracked.after.unreadEmails > tracked.after.totalEmails ||
          tracked.after.unreadThreads > tracked.after.totalThreads
        ) {
          throw new Error('invalid Mailbox aggregate delta');
        }
        await db
          .update(mailbox)
          .set({
            totalEmails: tracked.after.totalEmails,
            unreadEmails: tracked.after.unreadEmails,
            totalThreads: tracked.after.totalThreads,
            unreadThreads: tracked.after.unreadThreads,
            updatedAt: input.now,
          })
          .where(and(eq(mailbox.mailAccountId, input.accountId), eq(mailbox.id, mailboxId)));
        mailboxChanges.push({
          mailboxId,
          changedProperties: keys.filter((key) => tracked.before[key] !== tracked.after[key]),
        });
      }
      return { threadChanges, mailboxChanges };
    }),
});
