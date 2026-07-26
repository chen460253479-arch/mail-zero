import { and, asc, desc, eq, exists, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import {
  email,
  emailKeyword,
  emailMailbox,
  emailSearch,
  mailboxThread,
  thread,
} from '../../../mail/postgres/schema';
import type { ThreadPageProjectionInput, ThreadPageProjectionResult } from '../port';
import { MailCoreError } from '@zero/mail-core';
import type { DB } from '../../../../db';

type Cursor = {
  version: 1;
  accountId: string;
  signature: string;
  latestReceivedAt: string;
  threadId: string;
};

const signature = (input: ThreadPageProjectionInput) =>
  JSON.stringify({
    mailboxId: input.mailboxId ?? null,
    text: input.text?.trim().toLocaleLowerCase('und') ?? null,
    hasKeyword: input.hasKeyword ?? null,
    lifecycle: input.lifecycle ?? null,
    snoozed: input.snoozed ?? null,
  });

const encode = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decode = (value: string, input: ThreadPageProjectionInput): Cursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (
      parsed.version !== 1 ||
      parsed.accountId !== input.accountId ||
      parsed.signature !== signature(input) ||
      Number.isNaN(new Date(parsed.latestReceivedAt).getTime())
    ) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new MailCoreError('INVALID_CURSOR');
  }
};

export async function queryThreadPage(
  db: DB,
  input: ThreadPageProjectionInput,
): Promise<ThreadPageProjectionResult> {
  const cursor = input.cursor === undefined ? null : decode(input.cursor, input);
  const membership =
    input.mailboxId === undefined
      ? undefined
      : exists(
          db
            .select({ one: sql`1` })
            .from(mailboxThread)
            .where(
              and(
                eq(mailboxThread.mailAccountId, input.accountId),
                eq(mailboxThread.mailboxId, input.mailboxId),
                eq(mailboxThread.threadId, thread.id),
              ),
            ),
        );
  const matchingEmail = exists(
    db
      .select({ one: sql`1` })
      .from(email)
      .where(
        and(
          eq(email.mailAccountId, input.accountId),
          eq(email.threadId, thread.id),
          isNull(email.destroyedAt),
          input.lifecycle === undefined ? undefined : eq(email.lifecycle, input.lifecycle),
          input.hasKeyword === undefined
            ? undefined
            : exists(
                db
                  .select({ one: sql`1` })
                  .from(emailKeyword)
                  .where(
                    and(
                      eq(emailKeyword.mailAccountId, input.accountId),
                      eq(emailKeyword.emailId, email.id),
                      eq(emailKeyword.keyword, input.hasKeyword),
                    ),
                  ),
              ),
          input.text === undefined
            ? undefined
            : exists(
                db
                  .select({ one: sql`1` })
                  .from(emailSearch)
                  .where(
                    and(
                      eq(emailSearch.mailAccountId, input.accountId),
                      eq(emailSearch.emailId, email.id),
                      sql`${emailSearch.document} @@ websearch_to_tsquery('simple', ${input.text})`,
                    ),
                  ),
              ),
        ),
      ),
  );
  const position =
    cursor === null
      ? undefined
      : or(
          lt(thread.latestReceivedAt, new Date(cursor.latestReceivedAt)),
          and(
            eq(thread.latestReceivedAt, new Date(cursor.latestReceivedAt)),
            lt(thread.id, cursor.threadId),
          ),
        );
  const rows = await db
    .select()
    .from(thread)
    .where(
      and(
        eq(thread.mailAccountId, input.accountId),
        membership,
        matchingEmail,
        position,
        input.snoozed === true ? sql`false` : undefined,
      ),
    )
    .orderBy(desc(thread.latestReceivedAt), desc(thread.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  if (page.length === 0) return { items: [], cursor: null };
  const threadIds = page.map(({ id }) => id);
  const emails = await db
    .select({
      id: email.id,
      threadId: email.threadId,
      subject: email.subject,
      preview: email.preview,
      lifecycle: email.lifecycle,
      receivedAt: email.receivedAt,
    })
    .from(email)
    .where(
      and(
        eq(email.mailAccountId, input.accountId),
        inArray(email.threadId, threadIds),
        isNull(email.destroyedAt),
      ),
    )
    .orderBy(asc(email.receivedAt), asc(email.id));
  const emailIds = new Map<string, string[]>();
  const latest = new Map<string, (typeof emails)[number]>();
  for (const item of emails) {
    emailIds.set(item.threadId, [...(emailIds.get(item.threadId) ?? []), item.id]);
    latest.set(item.threadId, item);
  }
  const latestIds = [...latest.values()].map(({ id }) => id);
  const [mailboxes, keywords] = await Promise.all([
    db
      .select({ emailId: emailMailbox.emailId, value: emailMailbox.mailboxId })
      .from(emailMailbox)
      .where(
        and(
          eq(emailMailbox.mailAccountId, input.accountId),
          inArray(emailMailbox.emailId, latestIds),
        ),
      ),
    db
      .select({ emailId: emailKeyword.emailId, value: emailKeyword.keyword })
      .from(emailKeyword)
      .where(
        and(
          eq(emailKeyword.mailAccountId, input.accountId),
          inArray(emailKeyword.emailId, latestIds),
        ),
      ),
  ]);
  const mapValues = (rows: Array<{ emailId: string; value: string }>, id: string) =>
    Object.fromEntries(
      rows.filter((row) => row.emailId === id).map(({ value }) => [value, true as const]),
    ) as Record<string, true>;
  const items = page.flatMap((row) => {
    const latestEmail = latest.get(row.id);
    if (latestEmail === undefined) return [];
    return [
      {
        id: row.id,
        emailIds: emailIds.get(row.id) ?? [],
        emailCount: row.emailCount,
        unreadCount: row.unreadCount,
        hasAttachment: row.hasAttachment,
        subject: latestEmail.subject ?? '',
        preview: row.preview ?? latestEmail.preview ?? '',
        participants: row.participantSummary,
        latestReceivedAt: row.latestReceivedAt.toISOString(),
        mailboxIds: mapValues(mailboxes, latestEmail.id),
        keywords: mapValues(keywords, latestEmail.id),
        latestEmail: {
          id: latestEmail.id,
          lifecycle: latestEmail.lifecycle,
          receivedAt: latestEmail.receivedAt.toISOString(),
        },
      },
    ];
  });
  const last = page.at(-1);
  return {
    items,
    cursor:
      rows.length > input.limit && last !== undefined
        ? encode({
            version: 1,
            accountId: input.accountId,
            signature: signature(input),
            latestReceivedAt: last.latestReceivedAt.toISOString(),
            threadId: last.id,
          })
        : null,
  };
}
