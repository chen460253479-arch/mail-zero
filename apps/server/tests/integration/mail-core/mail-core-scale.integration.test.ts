import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

import {
  queryThreads,
  type EmailAggregateProjection,
  type EmailId,
  type MailboxId,
  type ThreadId,
} from '@zero/mail-core';

import {
  email,
  emailKeyword,
  emailMailbox,
  mailbox,
  mailboxThread,
  thread,
} from '../../../src/modules/mail/postgres/schema';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

const runScaleTest = process.env.MAIL_CORE_SCALE_TEST === '1';

describe('PostgreSQL mail core scale path', () => {
  it.skipIf(!runScaleTest)(
    'keeps thread paging and aggregate deltas bounded at 100k Email scale',
    () =>
      withMailTestDatabase(async ({ db, unitOfWork }) => {
        const h = await createPostgresMailTestHarness(db, unitOfWork, 'scale');
        const mailboxCountRows = (await db.execute(
          sql`SELECT count(*)::integer AS count FROM ${mailbox}
              WHERE mail_account_id = ${h.accountId}`,
        )) as unknown as { count: number }[];
        const mailboxesToAdd = 30 - mailboxCountRows[0]!.count;
        if (mailboxesToAdd > 0) {
          await db.execute(sql`
            INSERT INTO ${mailbox} (
              id,
              mail_account_id,
              parent_id,
              name,
              normalized_name,
              kind,
              role,
              color,
              sort_order,
              is_subscribed,
              total_emails,
              unread_emails,
              total_threads,
              unread_threads,
              created_at,
              updated_at,
              deleted_at
            )
            SELECT
              'scale-mailbox-' || lpad(series::text, 4, '0'),
              ${h.accountId},
              NULL,
              'Scale ' || series::text,
              'scale ' || series::text,
              'folder',
              NULL,
              NULL,
              series,
              true,
              0,
              0,
              0,
              0,
              timestamptz '2026-03-01T00:00:00.000Z',
              timestamptz '2026-03-01T00:00:00.000Z',
              NULL
            FROM generate_series(1, ${mailboxesToAdd}) AS series
          `);
        }

        await db.execute(sql`
          INSERT INTO ${thread} (
            id,
            mail_account_id,
            normalized_subject,
            latest_received_at,
            email_count,
            unread_count,
            has_attachment,
            participant_summary,
            preview,
            created_at,
            updated_at
          )
          SELECT
            'scale-thread-' || lpad(series::text, 5, '0'),
            ${h.accountId},
            'scale subject ' || series::text,
            timestamptz '2026-03-01T00:00:00.000Z' + series * interval '1 second',
            5,
            CASE WHEN series % 2 = 1 THEN 3 ELSE 2 END,
            false,
            NULL,
            'scale preview ' || series::text,
            timestamptz '2026-03-01T00:00:00.000Z',
            timestamptz '2026-03-01T00:00:00.000Z'
          FROM generate_series(1, 20000) AS series
        `);
        await db.execute(sql`
          INSERT INTO ${email} (
            id,
            mail_account_id,
            identity_id,
            thread_id,
            blob_id,
            message_id_header,
            reply_to_email_id,
            in_reply_to,
            "references",
            subject,
            normalized_subject,
            preview,
            sent_at,
            received_at,
            size_bytes,
            has_attachment,
            lifecycle,
            draft_revision,
            created_at,
            updated_at,
            destroyed_at
          )
          SELECT
            'scale-email-' || lpad(series::text, 6, '0'),
            ${h.accountId},
            NULL,
            'scale-thread-' || lpad((((series - 1) / 5) + 1)::text, 5, '0'),
            NULL,
            'scale-' || series::text || '@example.test',
            NULL,
            ARRAY[]::text[],
            ARRAY[]::text[],
            'Scale subject',
            'scale subject',
            'scale preview',
            NULL,
            timestamptz '2026-03-01T00:00:00.000Z' + series * interval '1 millisecond',
            1,
            false,
            'received',
            0,
            timestamptz '2026-03-01T00:00:00.000Z',
            timestamptz '2026-03-01T00:00:00.000Z',
            NULL
          FROM generate_series(1, 100000) AS series
        `);
        await db.execute(sql`
          INSERT INTO ${emailMailbox} (mail_account_id, email_id, mailbox_id, position)
          SELECT
            ${h.accountId},
            'scale-email-' || lpad(series::text, 6, '0'),
            ${h.inbox.id},
            0
          FROM generate_series(1, 100000) AS series
          UNION ALL
          SELECT
            ${h.accountId},
            'scale-email-' || lpad(series::text, 6, '0'),
            'scale-mailbox-0001',
            1
          FROM generate_series(10, 100000, 10) AS series
        `);
        await db.execute(sql`
          INSERT INTO ${emailKeyword} (mail_account_id, email_id, keyword, position)
          SELECT
            ${h.accountId},
            'scale-email-' || lpad(series::text, 6, '0'),
            '$seen',
            0
          FROM generate_series(2, 100000, 2) AS series
        `);
        await db.execute(sql`
          INSERT INTO ${mailboxThread} (
            mail_account_id,
            mailbox_id,
            thread_id,
            email_count,
            unread_count
          )
          SELECT
            ${h.accountId},
            ${h.inbox.id},
            'scale-thread-' || lpad(series::text, 5, '0'),
            5,
            CASE WHEN series % 2 = 1 THEN 3 ELSE 2 END
          FROM generate_series(1, 20000) AS series
        `);
        await db.execute(sql`
          INSERT INTO ${mailboxThread} (
            mail_account_id,
            mailbox_id,
            thread_id,
            email_count,
            unread_count
          )
          SELECT
            ${h.accountId},
            'scale-mailbox-0001',
            'scale-thread-' || lpad(series::text, 5, '0'),
            1,
            0
          FROM generate_series(2, 20000, 2) AS series
        `);
        await db.execute(sql`
          UPDATE ${mailbox}
          SET
            total_emails = 100000,
            unread_emails = 50000,
            total_threads = 20000,
            unread_threads = 20000
          WHERE mail_account_id = ${h.accountId}
            AND id = ${h.inbox.id}
        `);
        await db.execute(sql`
          UPDATE ${mailbox}
          SET
            total_emails = 10000,
            unread_emails = 0,
            total_threads = 10000,
            unread_threads = 0
          WHERE mail_account_id = ${h.accountId}
            AND id = 'scale-mailbox-0001'
        `);
        await db.execute(sql`ANALYZE ${thread}`);
        await db.execute(sql`ANALYZE ${email}`);
        await db.execute(sql`ANALYZE ${emailMailbox}`);
        await db.execute(sql`ANALYZE ${emailKeyword}`);
        await db.execute(sql`ANALYZE ${mailboxThread}`);

        const page = await queryThreads(h.dependencies, {
          accountId: h.accountId,
          mailboxId: h.inbox.id,
          limit: 25,
          cursor: null,
        });
        expect(page.threads).toHaveLength(25);
        expect(page.threads.flatMap(({ emailIds }) => emailIds)).toHaveLength(125);
        expect(page.nextCursor).not.toBeNull();

        const changedThreadId = 'scale-thread-00001' as ThreadId;
        const changedEmailId = 'scale-email-000001' as EmailId;
        const unaffectedThreadId = 'scale-thread-00002' as ThreadId;
        const unaffectedMailboxId = 'scale-mailbox-0001' as MailboxId;
        const unaffectedBefore = {
          thread: await unitOfWork.run((tx) =>
            tx.threads.findById(h.accountId, unaffectedThreadId),
          ),
          mailbox: await unitOfWork.run((tx) =>
            tx.mailboxes.findById(h.accountId, unaffectedMailboxId),
          ),
          mailboxThreads: await db
            .select()
            .from(mailboxThread)
            .where(
              and(
                eq(mailboxThread.mailAccountId, h.accountId),
                eq(mailboxThread.threadId, unaffectedThreadId),
              ),
            )
            .orderBy(mailboxThread.mailboxId),
        };
        const projection = (unread: boolean): EmailAggregateProjection => ({
          emailId: changedEmailId,
          threadId: changedThreadId,
          mailboxIds: [h.inbox.id as MailboxId],
          visible: true,
          unread,
          hasAttachment: false,
          receivedAt: new Date('2026-03-01T00:00:00.001Z'),
        });
        await db.insert(emailKeyword).values({
          mailAccountId: h.accountId,
          emailId: changedEmailId,
          keyword: '$seen',
          position: 0,
        });
        await unitOfWork.run((tx) =>
          tx.mailAggregates.applyEmailDelta({
            accountId: h.accountId,
            before: projection(true),
            after: projection(false),
            now: new Date('2026-03-02T00:00:00.000Z'),
          }),
        );
        await unitOfWork.run(async (tx) => {
          expect(await tx.threads.findById(h.accountId, changedThreadId)).toMatchObject({
            emailCount: 5,
            unreadCount: 2,
          });
          expect(await tx.threads.findById(h.accountId, unaffectedThreadId)).toMatchObject({
            emailCount: 5,
            unreadCount: 2,
          });
          expect(await tx.mailboxes.findById(h.accountId, h.inbox.id)).toMatchObject({
            totalEmails: 100000,
            unreadEmails: 49999,
            totalThreads: 20000,
            unreadThreads: 20000,
          });
        });
        expect(
          await unitOfWork.run((tx) => tx.threads.findById(h.accountId, unaffectedThreadId)),
        ).toEqual(unaffectedBefore.thread);
        expect(
          await unitOfWork.run((tx) => tx.mailboxes.findById(h.accountId, unaffectedMailboxId)),
        ).toEqual(unaffectedBefore.mailbox);
        expect(
          await db
            .select()
            .from(mailboxThread)
            .where(
              and(
                eq(mailboxThread.mailAccountId, h.accountId),
                eq(mailboxThread.threadId, unaffectedThreadId),
              ),
            )
            .orderBy(mailboxThread.mailboxId),
        ).toEqual(unaffectedBefore.mailboxThreads);

        const planRows = await db.transaction(async (tx) => {
          return (await tx.execute(sql`
            EXPLAIN (COSTS OFF)
            SELECT t.*
            FROM ${thread} t
            WHERE t.mail_account_id = ${h.accountId}
              AND COALESCE((
                SELECT mt.email_count > 0
                FROM ${mailboxThread} mt
                WHERE mt.mail_account_id = t.mail_account_id
                  AND mt.mailbox_id = ${h.inbox.id}
                  AND mt.thread_id = t.id
                LIMIT 1
              ), false)
            ORDER BY t.latest_received_at DESC NULLS LAST, t.id ASC
            LIMIT 26
          `)) as unknown as { 'QUERY PLAN': string }[];
        });
        const plan = planRows.map((row) => row['QUERY PLAN']).join('\n');
        expect(plan).toContain('thread_account_latest_id_idx');
        expect(plan).not.toMatch(/^\s*(?:Incremental )?Sort\b/mu);
      }),
    120_000,
  );
});
