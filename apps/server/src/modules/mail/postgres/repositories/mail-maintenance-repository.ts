import type {
  AggregateMismatch,
  MailAggregateMaintenanceRepository,
  MailAggregateValues,
} from '@zero/mail-core';
import { sql } from 'drizzle-orm';

import {
  email,
  emailAddress,
  emailKeyword,
  emailMailbox,
  mailbox,
  mailboxThread,
  thread,
} from '../schema';
import { runAdapter, type MailDatabase } from './database';

type ThreadAuditRow = {
  entity_id: string;
  actual_latest_received_at: Date | string;
  actual_email_count: number;
  actual_unread_count: number;
  actual_has_attachment: boolean;
  actual_participant_summary: string | null;
  actual_preview: string | null;
  expected_latest_received_at: Date | string;
  expected_email_count: number;
  expected_unread_count: number;
  expected_has_attachment: boolean;
  expected_participant_summary: string | null;
  expected_preview: string | null;
};

type MailboxAuditRow = {
  entity_id: string;
  actual_total_emails: number;
  actual_unread_emails: number;
  actual_total_threads: number;
  actual_unread_threads: number;
  expected_total_emails: number;
  expected_unread_emails: number;
  expected_total_threads: number;
  expected_unread_threads: number;
};

type MailboxThreadAuditRow = {
  mailbox_id: string;
  thread_id: string;
  actual_email_count: number | null;
  actual_unread_count: number | null;
  expected_email_count: number;
  expected_unread_count: number;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const valuesEqual = (expected: MailAggregateValues, actual: MailAggregateValues | null): boolean =>
  actual !== null && JSON.stringify(expected) === JSON.stringify(actual);

const auditThreads = async (db: MailDatabase, accountId: string): Promise<AggregateMismatch[]> => {
  const rows = (await db.execute(sql`
    SELECT
      t.id AS entity_id,
      t.latest_received_at AS actual_latest_received_at,
      t.email_count AS actual_email_count,
      t.unread_count AS actual_unread_count,
      t.has_attachment AS actual_has_attachment,
      t.participant_summary AS actual_participant_summary,
      t.preview AS actual_preview,
      COALESCE(latest.received_at, t.latest_received_at) AS expected_latest_received_at,
      COALESCE(counts.email_count, 0)::integer AS expected_email_count,
      COALESCE(counts.unread_count, 0)::integer AS expected_unread_count,
      COALESCE(counts.has_attachment, false) AS expected_has_attachment,
      participants.summary AS expected_participant_summary,
      latest.preview AS expected_preview
    FROM ${thread} t
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS email_count,
        count(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${emailKeyword} ek
            WHERE ek.mail_account_id = e.mail_account_id
              AND ek.email_id = e.id
              AND ek.keyword = '$seen'
          )
        ) AS unread_count,
        bool_or(e.has_attachment) AS has_attachment
      FROM ${email} e
      WHERE e.mail_account_id = t.mail_account_id
        AND e.thread_id = t.id
        AND e.destroyed_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM ${emailMailbox} em
          WHERE em.mail_account_id = e.mail_account_id
            AND em.email_id = e.id
        )
    ) counts ON true
    LEFT JOIN LATERAL (
      SELECT e.id, e.received_at, e.preview
      FROM ${email} e
      WHERE e.mail_account_id = t.mail_account_id
        AND e.thread_id = t.id
        AND e.destroyed_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM ${emailMailbox} em
          WHERE em.mail_account_id = e.mail_account_id
            AND em.email_id = e.id
        )
      ORDER BY e.received_at DESC, e.id DESC
      LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(selected.display_name, ', ' ORDER BY selected.first_position) AS summary
      FROM (
        SELECT
          COALESCE(NULLIF(btrim(ea.name), ''), ea.email) AS display_name,
          min(
            CASE ea.kind WHEN 'from' THEN 0 WHEN 'to' THEN 1 ELSE 2 END * 1000000
              + ea.position
          ) AS first_position
        FROM ${emailAddress} ea
        WHERE ea.mail_account_id = t.mail_account_id
          AND ea.email_id = latest.id
          AND ea.kind IN ('from', 'to', 'cc')
        GROUP BY COALESCE(NULLIF(btrim(ea.name), ''), ea.email)
        ORDER BY first_position
        LIMIT 3
      ) selected
    ) participants ON latest.id IS NOT NULL
    WHERE t.mail_account_id = ${accountId}
    ORDER BY t.id
  `)) as unknown as ThreadAuditRow[];
  return rows.flatMap((row) => {
    const expected: MailAggregateValues = {
      latestReceivedAt: iso(row.expected_latest_received_at),
      emailCount: row.expected_email_count,
      unreadCount: row.expected_unread_count,
      hasAttachment: row.expected_has_attachment,
      participantSummary: row.expected_participant_summary,
      preview: row.expected_preview,
    };
    const actual: MailAggregateValues = {
      latestReceivedAt: iso(row.actual_latest_received_at),
      emailCount: row.actual_email_count,
      unreadCount: row.actual_unread_count,
      hasAttachment: row.actual_has_attachment,
      participantSummary: row.actual_participant_summary,
      preview: row.actual_preview,
    };
    return valuesEqual(expected, actual)
      ? []
      : [{ entityType: 'thread', entityId: row.entity_id, expected, actual }];
  });
};

const auditMailboxes = async (
  db: MailDatabase,
  accountId: string,
): Promise<AggregateMismatch[]> => {
  const rows = (await db.execute(sql`
    SELECT
      m.id AS entity_id,
      m.total_emails AS actual_total_emails,
      m.unread_emails AS actual_unread_emails,
      m.total_threads AS actual_total_threads,
      m.unread_threads AS actual_unread_threads,
      COALESCE(truth.total_emails, 0)::integer AS expected_total_emails,
      COALESCE(truth.unread_emails, 0)::integer AS expected_unread_emails,
      COALESCE(truth.total_threads, 0)::integer AS expected_total_threads,
      COALESCE(truth.unread_threads, 0)::integer AS expected_unread_threads
    FROM ${mailbox} m
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS total_emails,
        count(*) FILTER (WHERE membership.is_unread) AS unread_emails,
        count(DISTINCT membership.thread_id) AS total_threads,
        count(DISTINCT membership.thread_id) FILTER (WHERE membership.is_unread) AS unread_threads
      FROM (
        SELECT
          e.id,
          e.thread_id,
          NOT EXISTS (
            SELECT 1
            FROM ${emailKeyword} ek
            WHERE ek.mail_account_id = e.mail_account_id
              AND ek.email_id = e.id
              AND ek.keyword = '$seen'
          ) AS is_unread
        FROM ${emailMailbox} em
        INNER JOIN ${email} e
          ON e.mail_account_id = em.mail_account_id
         AND e.id = em.email_id
        WHERE em.mail_account_id = m.mail_account_id
          AND em.mailbox_id = m.id
          AND e.destroyed_at IS NULL
      ) membership
    ) truth ON true
    WHERE m.mail_account_id = ${accountId}
    ORDER BY m.id
  `)) as unknown as MailboxAuditRow[];
  return rows.flatMap((row) => {
    const expected: MailAggregateValues = {
      totalEmails: row.expected_total_emails,
      unreadEmails: row.expected_unread_emails,
      totalThreads: row.expected_total_threads,
      unreadThreads: row.expected_unread_threads,
    };
    const actual: MailAggregateValues = {
      totalEmails: row.actual_total_emails,
      unreadEmails: row.actual_unread_emails,
      totalThreads: row.actual_total_threads,
      unreadThreads: row.actual_unread_threads,
    };
    return valuesEqual(expected, actual)
      ? []
      : [{ entityType: 'mailbox', entityId: row.entity_id, expected, actual }];
  });
};

const auditMailboxThreads = async (
  db: MailDatabase,
  accountId: string,
): Promise<AggregateMismatch[]> => {
  const rows = (await db.execute(sql`
    WITH expected AS (
      SELECT
        em.mailbox_id,
        e.thread_id,
        count(*)::integer AS email_count,
        count(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM ${emailKeyword} ek
            WHERE ek.mail_account_id = e.mail_account_id
              AND ek.email_id = e.id
              AND ek.keyword = '$seen'
          )
        )::integer AS unread_count
      FROM ${emailMailbox} em
      INNER JOIN ${email} e
        ON e.mail_account_id = em.mail_account_id
       AND e.id = em.email_id
      WHERE em.mail_account_id = ${accountId}
        AND e.destroyed_at IS NULL
      GROUP BY em.mailbox_id, e.thread_id
    ),
    actual AS (
      SELECT mailbox_id, thread_id, email_count, unread_count
      FROM ${mailboxThread}
      WHERE mail_account_id = ${accountId}
    )
    SELECT
      COALESCE(expected.mailbox_id, actual.mailbox_id) AS mailbox_id,
      COALESCE(expected.thread_id, actual.thread_id) AS thread_id,
      actual.email_count AS actual_email_count,
      actual.unread_count AS actual_unread_count,
      COALESCE(expected.email_count, 0)::integer AS expected_email_count,
      COALESCE(expected.unread_count, 0)::integer AS expected_unread_count
    FROM expected
    FULL OUTER JOIN actual USING (mailbox_id, thread_id)
    ORDER BY mailbox_id, thread_id
  `)) as unknown as MailboxThreadAuditRow[];
  return rows.flatMap((row) => {
    const expected: MailAggregateValues = {
      emailCount: row.expected_email_count,
      unreadCount: row.expected_unread_count,
    };
    const actual =
      row.actual_email_count === null || row.actual_unread_count === null
        ? null
        : {
            emailCount: row.actual_email_count,
            unreadCount: row.actual_unread_count,
          };
    return valuesEqual(expected, actual)
      ? []
      : [
          {
            entityType: 'mailbox_thread',
            entityId: `${row.mailbox_id}:${row.thread_id}`,
            expected,
            actual,
          },
        ];
  });
};

const repairThreads = (db: MailDatabase, accountId: string, now: Date): Promise<unknown> =>
  db.execute(sql`
    WITH expected AS (
      SELECT
        t.id,
        COALESCE(latest.received_at, t.latest_received_at) AS latest_received_at,
        COALESCE(counts.email_count, 0)::integer AS email_count,
        COALESCE(counts.unread_count, 0)::integer AS unread_count,
        COALESCE(counts.has_attachment, false) AS has_attachment,
        participants.summary AS participant_summary,
        latest.preview
      FROM ${thread} t
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS email_count,
          count(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM ${emailKeyword} ek
              WHERE ek.mail_account_id = e.mail_account_id
                AND ek.email_id = e.id
                AND ek.keyword = '$seen'
            )
          ) AS unread_count,
          bool_or(e.has_attachment) AS has_attachment
        FROM ${email} e
        WHERE e.mail_account_id = t.mail_account_id
          AND e.thread_id = t.id
          AND e.destroyed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM ${emailMailbox} em
            WHERE em.mail_account_id = e.mail_account_id
              AND em.email_id = e.id
          )
      ) counts ON true
      LEFT JOIN LATERAL (
        SELECT e.id, e.received_at, e.preview
        FROM ${email} e
        WHERE e.mail_account_id = t.mail_account_id
          AND e.thread_id = t.id
          AND e.destroyed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM ${emailMailbox} em
            WHERE em.mail_account_id = e.mail_account_id
              AND em.email_id = e.id
          )
        ORDER BY e.received_at DESC, e.id DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT string_agg(selected.display_name, ', ' ORDER BY selected.first_position) AS summary
        FROM (
          SELECT
            COALESCE(NULLIF(btrim(ea.name), ''), ea.email) AS display_name,
            min(
              CASE ea.kind WHEN 'from' THEN 0 WHEN 'to' THEN 1 ELSE 2 END * 1000000
                + ea.position
            ) AS first_position
          FROM ${emailAddress} ea
          WHERE ea.mail_account_id = t.mail_account_id
            AND ea.email_id = latest.id
            AND ea.kind IN ('from', 'to', 'cc')
          GROUP BY COALESCE(NULLIF(btrim(ea.name), ''), ea.email)
          ORDER BY first_position
          LIMIT 3
        ) selected
      ) participants ON latest.id IS NOT NULL
      WHERE t.mail_account_id = ${accountId}
    )
    UPDATE ${thread} t
    SET
      latest_received_at = expected.latest_received_at,
      email_count = expected.email_count,
      unread_count = expected.unread_count,
      has_attachment = expected.has_attachment,
      participant_summary = expected.participant_summary,
      preview = expected.preview,
      updated_at = ${now.toISOString()}::timestamptz
    FROM expected
    WHERE t.mail_account_id = ${accountId}
      AND t.id = expected.id
      AND (
        t.latest_received_at,
        t.email_count,
        t.unread_count,
        t.has_attachment,
        t.participant_summary,
        t.preview
      ) IS DISTINCT FROM (
        expected.latest_received_at,
        expected.email_count,
        expected.unread_count,
        expected.has_attachment,
        expected.participant_summary,
        expected.preview
      )
  `);

const repairMailboxes = (db: MailDatabase, accountId: string, now: Date): Promise<unknown> =>
  db.execute(sql`
    WITH expected AS (
      SELECT
        m.id,
        count(e.id)::integer AS total_emails,
        count(e.id) FILTER (WHERE e.id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ${emailKeyword} ek
          WHERE ek.mail_account_id = e.mail_account_id
            AND ek.email_id = e.id
            AND ek.keyword = '$seen'
        ))::integer AS unread_emails,
        count(DISTINCT e.thread_id)::integer AS total_threads,
        count(DISTINCT e.thread_id) FILTER (WHERE e.id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ${emailKeyword} ek
          WHERE ek.mail_account_id = e.mail_account_id
            AND ek.email_id = e.id
            AND ek.keyword = '$seen'
        ))::integer AS unread_threads
      FROM ${mailbox} m
      LEFT JOIN ${emailMailbox} em
        ON em.mail_account_id = m.mail_account_id
       AND em.mailbox_id = m.id
      LEFT JOIN ${email} e
        ON e.mail_account_id = em.mail_account_id
       AND e.id = em.email_id
       AND e.destroyed_at IS NULL
      WHERE m.mail_account_id = ${accountId}
      GROUP BY m.id
    )
    UPDATE ${mailbox} m
    SET
      total_emails = expected.total_emails,
      unread_emails = expected.unread_emails,
      total_threads = expected.total_threads,
      unread_threads = expected.unread_threads,
      updated_at = ${now.toISOString()}::timestamptz
    FROM expected
    WHERE m.mail_account_id = ${accountId}
      AND m.id = expected.id
      AND (
        m.total_emails,
        m.unread_emails,
        m.total_threads,
        m.unread_threads
      ) IS DISTINCT FROM (
        expected.total_emails,
        expected.unread_emails,
        expected.total_threads,
        expected.unread_threads
      )
  `);

const repairMailboxThreads = async (db: MailDatabase, accountId: string): Promise<void> => {
  await db.execute(sql`DELETE FROM ${mailboxThread} WHERE mail_account_id = ${accountId}`);
  await db.execute(sql`
    INSERT INTO ${mailboxThread} (
      mail_account_id,
      mailbox_id,
      thread_id,
      email_count,
      unread_count
    )
    SELECT
      em.mail_account_id,
      em.mailbox_id,
      e.thread_id,
      count(*)::integer,
      count(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM ${emailKeyword} ek
          WHERE ek.mail_account_id = e.mail_account_id
            AND ek.email_id = e.id
            AND ek.keyword = '$seen'
        )
      )::integer
    FROM ${emailMailbox} em
    INNER JOIN ${email} e
      ON e.mail_account_id = em.mail_account_id
     AND e.id = em.email_id
    WHERE em.mail_account_id = ${accountId}
      AND e.destroyed_at IS NULL
    GROUP BY em.mail_account_id, em.mailbox_id, e.thread_id
  `);
};

export const createMailAggregateMaintenanceRepository = (
  db: MailDatabase,
): MailAggregateMaintenanceRepository => ({
  reconcile: (input) =>
    runAdapter(async () => {
      const mismatches = [
        ...(await auditThreads(db, input.accountId)),
        ...(await auditMailboxes(db, input.accountId)),
        ...(await auditMailboxThreads(db, input.accountId)),
      ];
      if (input.repair && mismatches.length > 0) {
        await repairThreads(db, input.accountId, input.now);
        await repairMailboxes(db, input.accountId, input.now);
        await repairMailboxThreads(db, input.accountId);
      }
      return { mismatches, repaired: input.repair };
    }),
});
