import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Sql } from 'postgres';

import {
  blob,
  email,
  emailContent,
  emailPart,
  emailSubmission,
  mailIdentity,
  mailbox,
  remoteEmail,
} from '../../../src/db/schema';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

const blobReferenceIndexes = new Set([
  'email_blob_account_idx',
  'email_content_text_blob_account_idx',
  'email_content_html_blob_account_idx',
  'email_part_blob_account_idx',
]);
const submissionIndexes = new Set([
  'email_submission_account_created_id_idx',
  'email_submission_account_identity_created_id_idx',
]);

const seedPlannerFixtures = async (
  connection: Sql,
  accountId: string,
  indexName: string,
): Promise<void> => {
  if (blobReferenceIndexes.has(indexName) || indexName === 'blob_account_created_id_idx') {
    await connection`
      INSERT INTO mail.blob (
        id, mail_account_id, sha256, size_bytes, content_type, object_key, status, created_at
      )
      SELECT
        'plan-blob-' || lpad(value::text, 4, '0'),
        ${accountId},
        'plan-sha-' || value,
        value,
        'text/plain',
        'plan-object-' || value,
        'pending',
        now() + value * interval '1 second'
      FROM generate_series(1, 1000) AS value
    `;
  }
  if (indexName === 'mail_identity_account_created_active_idx') {
    await connection`
      INSERT INTO mail.identity (
        id, mail_account_id, email, is_default, created_at, updated_at
      )
      SELECT
        'plan-identity-' || lpad(value::text, 4, '0'),
        ${accountId},
        'identity-' || value || '@example.test',
        false,
        now() + value * interval '1 second',
        now()
      FROM generate_series(1, 1000) AS value
    `;
  }
  if (indexName === 'mailbox_account_sort_active_idx') {
    await connection`
      INSERT INTO mail.mailbox (
        id, mail_account_id, name, normalized_name, kind, sort_order,
        is_subscribed, total_emails, unread_emails, total_threads, unread_threads,
        created_at, updated_at
      )
      SELECT
        'plan-mailbox-' || lpad(value::text, 4, '0'),
        ${accountId},
        'Plan Mailbox ' || value,
        'plan-mailbox-' || value,
        'folder',
        value,
        true,
        0,
        0,
        0,
        0,
        now(),
        now()
      FROM generate_series(1, 1000) AS value
    `;
  }
  if (
    blobReferenceIndexes.has(indexName) ||
    submissionIndexes.has(indexName) ||
    indexName === 'remote_email_email_account_idx'
  ) {
    await connection`
      INSERT INTO mail.thread (
        id, mail_account_id, normalized_subject, latest_received_at,
        email_count, unread_count, has_attachment, created_at, updated_at
      ) VALUES (
        'plan-thread', ${accountId}, 'plan', now(), 0, 0, false, now(), now()
      )
    `;
  }
  if (blobReferenceIndexes.has(indexName)) {
    await connection`
      INSERT INTO mail.email (
        id, mail_account_id, thread_id, blob_id, normalized_subject,
        received_at, size_bytes, has_attachment, lifecycle, draft_revision,
        created_at, updated_at
      )
      SELECT
        'plan-email-' || lpad(value::text, 4, '0'),
        ${accountId},
        'plan-thread',
        'plan-blob-' || lpad(value::text, 4, '0'),
        'plan',
        now(),
        1,
        false,
        'received',
        0,
        now(),
        now()
      FROM generate_series(1, 1000) AS value
    `;
  }
  if (
    indexName === 'email_content_text_blob_account_idx' ||
    indexName === 'email_content_html_blob_account_idx'
  ) {
    await connection`
      INSERT INTO mail.email_content (
        mail_account_id, email_id, parser_version, text_blob_id, html_blob_id, parsed_at
      )
      SELECT
        ${accountId},
        'plan-email-' || lpad(value::text, 4, '0'),
        1,
        'plan-blob-' || lpad(value::text, 4, '0'),
        'plan-blob-' || lpad(value::text, 4, '0'),
        now()
      FROM generate_series(1, 1000) AS value
    `;
  }
  if (indexName === 'email_part_blob_account_idx') {
    await connection`
      INSERT INTO mail.email_part (
        id, mail_account_id, email_id, position, part_path, content_type,
        blob_id, size_bytes, kind
      )
      SELECT
        'plan-part-' || lpad(value::text, 4, '0'),
        ${accountId},
        'plan-email-' || lpad(value::text, 4, '0'),
        0,
        '1',
        'application/octet-stream',
        'plan-blob-' || lpad(value::text, 4, '0'),
        1,
        'attachment'
      FROM generate_series(1, 1000) AS value
    `;
  }
  if (submissionIndexes.has(indexName)) {
    await connection`
      INSERT INTO mail.identity (
        id, mail_account_id, email, is_default, created_at, updated_at
      )
      SELECT
        'plan-submission-identity-' || lpad(value::text, 2, '0'),
        ${accountId},
        'submission-' || value || '@example.test',
        false,
        now(),
        now()
      FROM generate_series(1, 10) AS value
    `;
    await connection`
      INSERT INTO mail.email (
        id, mail_account_id, thread_id, normalized_subject, received_at,
        size_bytes, has_attachment, lifecycle, draft_revision, created_at, updated_at
      ) VALUES (
        'plan-submission-email', ${accountId}, 'plan-thread', 'plan', now(),
        1, false, 'received', 0, now(), now()
      )
    `;
    await connection`
      INSERT INTO mail.submission (
        id, mail_account_id, email_id, identity_id, status, send_at,
        idempotency_key, draft_revision, created_at, updated_at
      )
      SELECT
        'plan-submission-' || lpad(value::text, 4, '0'),
        ${accountId},
        'plan-submission-email',
        'plan-submission-identity-' || lpad((((value - 1) % 10) + 1)::text, 2, '0'),
        'queued',
        now(),
        'plan-idempotency-' || value,
        0,
        now() + value * interval '1 second',
        now()
      FROM generate_series(1, 1000) AS value
    `;
  }
  if (indexName === 'remote_email_email_account_idx') {
    await connection`
      INSERT INTO mail.email (
        id, mail_account_id, thread_id, normalized_subject, received_at,
        size_bytes, has_attachment, lifecycle, draft_revision, created_at, updated_at
      )
      SELECT
        'plan-remote-email-' || lpad(value::text, 4, '0'),
        ${accountId},
        'plan-thread',
        'plan',
        now(),
        1,
        false,
        'received',
        0,
        now(),
        now()
      FROM generate_series(1, 1000) AS value
    `;
    await connection`
      INSERT INTO integration.remote_email (
        mail_account_id, provider, remote_email_id, email_id, first_seen_at, last_seen_at
      )
      SELECT
        ${accountId},
        'test',
        'plan-remote-' || value,
        'plan-remote-email-' || lpad(value::text, 4, '0'),
        now(),
        now()
      FROM generate_series(1, 1000) AS value
    `;
  }
};

describe('mail repository supporting indexes', () => {
  it('filters soft-deleted Mailboxes before returning the ordered account list', async () => {
    await withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'active-mailbox-list');
      await db
        .update(mailbox)
        .set({ deletedAt: new Date('2026-01-02T00:00:00.000Z') })
        .where(eq(mailbox.id, harness.drafts.id));

      const listed = await unitOfWork.run((stores) =>
        stores.mailboxes.listByAccount(harness.accountId),
      );

      expect(listed.map(({ id }) => id)).toContain(harness.inbox.id);
      expect(listed.map(({ id }) => id)).not.toContain(harness.drafts.id);
    });
  });

  it.each([
    [
      'Email Blob references',
      'email_blob_account_idx',
      (accountId: string) => sql`
        SELECT ${email.id}
        FROM ${email}
        WHERE ${email.blobId} = 'plan-blob-0500'
          AND ${email.mailAccountId} = ${accountId}
      `,
    ],
    [
      'EmailContent text Blob references',
      'email_content_text_blob_account_idx',
      (accountId: string) => sql`
        SELECT ${emailContent.emailId}
        FROM ${emailContent}
        WHERE ${emailContent.textBlobId} = 'plan-blob-0500'
          AND ${emailContent.mailAccountId} = ${accountId}
      `,
    ],
    [
      'EmailContent HTML Blob references',
      'email_content_html_blob_account_idx',
      (accountId: string) => sql`
        SELECT ${emailContent.emailId}
        FROM ${emailContent}
        WHERE ${emailContent.htmlBlobId} = 'plan-blob-0500'
          AND ${emailContent.mailAccountId} = ${accountId}
      `,
    ],
    [
      'EmailPart Blob references',
      'email_part_blob_account_idx',
      (accountId: string) => sql`
        SELECT ${emailPart.id}
        FROM ${emailPart}
        WHERE ${emailPart.blobId} = 'plan-blob-0500'
          AND ${emailPart.mailAccountId} = ${accountId}
      `,
    ],
    [
      'active Identity pages',
      'mail_identity_account_created_active_idx',
      (accountId: string) => sql`
        SELECT ${mailIdentity.id}
        FROM ${mailIdentity}
        WHERE ${mailIdentity.mailAccountId} = ${accountId}
          AND ${mailIdentity.deletedAt} IS NULL
        ORDER BY ${mailIdentity.createdAt}, ${mailIdentity.id}
        LIMIT 25
      `,
    ],
    [
      'active Mailbox pages',
      'mailbox_account_sort_active_idx',
      (accountId: string) => sql`
        SELECT ${mailbox.id}
        FROM ${mailbox}
        WHERE ${mailbox.mailAccountId} = ${accountId}
          AND ${mailbox.deletedAt} IS NULL
        ORDER BY ${mailbox.sortOrder}, ${mailbox.id}
        LIMIT 25
      `,
    ],
    [
      'Blob pages',
      'blob_account_created_id_idx',
      (accountId: string) => sql`
        SELECT ${blob.id}
        FROM ${blob}
        WHERE ${blob.mailAccountId} = ${accountId}
        ORDER BY ${blob.createdAt}, ${blob.id}
        LIMIT 25
      `,
    ],
    [
      'Submission pages',
      'email_submission_account_created_id_idx',
      (accountId: string) => sql`
        SELECT ${emailSubmission.id}
        FROM ${emailSubmission}
        WHERE ${emailSubmission.mailAccountId} = ${accountId}
        ORDER BY ${emailSubmission.createdAt}, ${emailSubmission.id}
        LIMIT 25
      `,
    ],
    [
      'Submission Identity pages',
      'email_submission_account_identity_created_id_idx',
      (accountId: string) => sql`
        SELECT ${emailSubmission.id}
        FROM ${emailSubmission}
        WHERE ${emailSubmission.mailAccountId} = ${accountId}
          AND ${emailSubmission.identityId} = 'plan-submission-identity-05'
        ORDER BY ${emailSubmission.createdAt}, ${emailSubmission.id}
        LIMIT 25
      `,
    ],
    [
      'RemoteEmail reverse lookup',
      'remote_email_email_account_idx',
      (accountId: string) => sql`
        SELECT ${remoteEmail.remoteEmailId}
        FROM ${remoteEmail}
        WHERE ${remoteEmail.emailId} = 'plan-remote-email-0500'
          AND ${remoteEmail.mailAccountId} = ${accountId}
      `,
    ],
  ] as const)('uses the intended index for %s', async (_label, indexName, query) => {
    await withMailTestDatabase(async ({ db, sql: connection, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, `plan-${indexName}`);
      await seedPlannerFixtures(connection, harness.accountId, indexName);
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`ANALYZE`);
        return (await tx.execute(
          sql`EXPLAIN (COSTS OFF) ${query(harness.accountId)}`,
        )) as unknown as { 'QUERY PLAN': string }[];
      });

      expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(indexName);
    });
  });
});
