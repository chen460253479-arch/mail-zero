import type {
  EmailAggregateProjection,
  EmailRecord,
  ThreadId,
  ThreadRecord,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailSnoozeRepository } from '../../src/modules/mail-snooze/postgres/repository';
import { createPostgresMailSnoozeCommands } from '../../src/modules/mail-snooze/postgres/commands';
import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

describe('Mail Snooze schema', () => {
  it('persists and lease-claims a due local Thread Snooze', () =>
    withMailTestDatabase(async ({ db, unitOfWork, sql }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'snooze-schema');
      const now = new Date('2026-01-01T00:00:00.000Z');
      const threadId = 'snooze-thread';
      await unitOfWork.run((tx) =>
        tx.threads.insert({
          id: threadId as never,
          accountId: h.accountId,
          normalizedSubject: 'snooze',
          latestReceivedAt: now,
          emailCount: 0,
          unreadCount: 0,
          hasAttachment: false,
          participantSummary: null,
          preview: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      const repository = createPostgresMailSnoozeRepository(db);
      await repository.schedule({
        accountId: h.accountId,
        threadId,
        wakeAt: now,
        restorePlan: [
          {
            emailId: 'email-1',
            addMailboxIds: [h.inbox.id],
            removeMailboxIds: ['archive'],
          },
        ],
        now,
      });

      const claimed = await repository.claimDue({
        now,
        limit: 10,
        leaseOwner: 'schema-worker',
        leaseForMs: 60_000,
      });

      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        threadId,
        status: 'waking',
        restorePlan: [
          {
            emailId: 'email-1',
            addMailboxIds: [h.inbox.id],
            removeMailboxIds: ['archive'],
          },
        ],
      });
      await expect(
        repository.schedule({
          accountId: h.accountId,
          threadId,
          wakeAt: new Date(now.getTime() + 120_000),
          restorePlan: [
            {
              emailId: 'email-1',
              addMailboxIds: [h.inbox.id],
              removeMailboxIds: ['archive'],
            },
          ],
          now: new Date(now.getTime() + 1_000),
        }),
      ).rejects.toThrow('SNOOZE_BUSY');
      const table = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'mail' AND table_name = 'thread_snooze'
      `;
      expect(table).toHaveLength(1);
    }));

  it('atomically preserves per-Email memberships across snooze and wake', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'snooze-atomic');
      const now = new Date('2026-01-01T00:00:00.000Z');
      const wakeAt = new Date(now.getTime() + 60_000);
      const archive = await unitOfWork.run((tx) => tx.mailboxes.findByRole(h.accountId, 'archive'));
      expect(archive).not.toBeNull();
      const threadId = 'snooze-atomic-thread' as ThreadId;
      const base = {
        accountId: h.accountId,
        identityId: null,
        threadId,
        blobId: null,
        messageId: null,
        replyToEmailId: null,
        inReplyTo: [],
        references: [],
        sentAt: null,
        receivedAt: now,
        sizeBytes: 1n,
        hasAttachment: false,
        lifecycle: 'received',
        draftRevision: 0,
        createdAt: now,
        updatedAt: now,
        destroyedAt: null,
        sender: [],
        from: [],
        replyTo: [],
        to: [],
        cc: [],
        bcc: [],
        preview: '',
        textBlobId: null,
        htmlBlobId: null,
        parserVersion: 1,
        parseWarnings: [],
        parts: [],
        restoreMailboxIds: [],
        keywords: [],
      } satisfies Omit<EmailRecord, 'id' | 'mailboxIds' | 'subject'>;
      await unitOfWork.run(async (tx) => {
        await tx.threads.insert({
          id: threadId as never,
          accountId: h.accountId,
          normalizedSubject: 'snooze-atomic',
          latestReceivedAt: now,
          emailCount: 0,
          unreadCount: 0,
          hasAttachment: false,
          participantSummary: null,
          preview: null,
          createdAt: now,
          updatedAt: now,
        } satisfies ThreadRecord);
        const inboxEmail = await tx.emails.insert({
          ...base,
          id: 'snooze-inbox-email' as never,
          subject: 'Inbox',
          mailboxIds: [h.inbox.id],
        });
        const archiveEmail = await tx.emails.insert({
          ...base,
          id: 'snooze-archive-email' as never,
          subject: 'Archive only',
          mailboxIds: [archive!.id],
        });
        for (const record of [inboxEmail, archiveEmail]) {
          await tx.mailAggregates.applyEmailDelta({
            accountId: h.accountId,
            before: null,
            after: {
              emailId: record.id,
              threadId: record.threadId,
              mailboxIds: record.mailboxIds,
              visible: true,
              unread: true,
              hasAttachment: false,
              receivedAt: record.receivedAt,
            } satisfies EmailAggregateProjection,
            now,
          });
        }
      });
      const commands = createPostgresMailSnoozeCommands({
        db,
        mailCoreDependencies: h.dependencies,
        clock: { now: () => now },
      });

      await expect(
        commands.snooze({ accountId: h.accountId, threadIds: [threadId], wakeAt }),
      ).resolves.toMatchObject({ scheduled: [threadId], failed: {} });
      await expect(
        unitOfWork.run((tx) => tx.emails.findById(h.accountId, 'snooze-inbox-email' as never)),
      ).resolves.toMatchObject({ mailboxIds: [archive!.id] });
      await expect(
        unitOfWork.run((tx) => tx.emails.findById(h.accountId, 'snooze-archive-email' as never)),
      ).resolves.toMatchObject({ mailboxIds: [archive!.id] });

      const repository = createPostgresMailSnoozeRepository(db);
      const claimed = await repository.claimDue({
        now: wakeAt,
        limit: 10,
        leaseOwner: 'atomic-worker',
        leaseForMs: 60_000,
      });
      expect(claimed).toHaveLength(1);
      await expect(commands.wakeClaimed(claimed[0]!, 'atomic-worker', wakeAt)).resolves.toBe(true);
      await expect(
        unitOfWork.run((tx) => tx.emails.findById(h.accountId, 'snooze-inbox-email' as never)),
      ).resolves.toMatchObject({ mailboxIds: [h.inbox.id] });
      await expect(
        unitOfWork.run((tx) => tx.emails.findById(h.accountId, 'snooze-archive-email' as never)),
      ).resolves.toMatchObject({ mailboxIds: [archive!.id] });
    }));
});
