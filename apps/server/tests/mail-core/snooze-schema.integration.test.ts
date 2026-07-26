import { describe, expect, it } from 'vitest';

import { createPostgresMailSnoozeRepository } from '../../src/modules/mail-snooze/postgres/repository';
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
        restoreMailboxIds: [h.inbox.id],
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
        restoreMailboxIds: [h.inbox.id],
      });
      const table = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'mail' AND table_name = 'thread_snooze'
      `;
      expect(table).toHaveLength(1);
    }));
});
