import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, ne, not, or, sql } from 'drizzle-orm';

import {
  email,
  emailAddress,
  emailKeyword,
  emailMailbox,
  emailSearch,
  mailboxThread,
  mailbox,
  thread,
} from '../../../mail/postgres/schema';
import { CRM_CUSTOMER_KEYWORD } from '../../../external-integration/contracts/customer-marker';
import { decodeSignedCursor, encodeSignedCursor, MailCoreError } from '@zero/mail-core';
import type { ThreadPageProjectionInput, ThreadPageProjectionResult } from '../port';
import { crmCustomerMarker } from '../../../external-integration/postgres/schema';
import { threadSnooze } from '../../../mail-snooze/postgres/schema';
import type { DB } from '../../../../db';
import { z } from 'zod';

const cursorSchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().min(1),
    query: z.string().min(1),
    latestReceivedAt: z.string().datetime({ offset: true }),
    threadId: z.string().min(1),
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;

const signature = (input: ThreadPageProjectionInput) =>
  JSON.stringify({
    mailboxId: input.mailboxId ?? null,
    text: input.text?.trim().toLocaleLowerCase('und') ?? null,
    hasKeyword: input.hasKeyword ?? null,
    hasKeywords: [...new Set(input.hasKeywords ?? [])].sort(),
    hasMailboxIds: [...new Set(input.hasMailboxIds ?? [])].sort(),
    unreadOnly: input.unreadOnly ?? null,
    lifecycle: input.lifecycle ?? null,
    snoozed: input.snoozed ?? null,
  });

const encode = (cursor: Cursor, signingKey: string) => encodeSignedCursor(cursor, signingKey);

const decode = (value: string, input: ThreadPageProjectionInput, signingKey: string): Cursor => {
  try {
    const result = cursorSchema.safeParse(decodeSignedCursor(value, signingKey));
    if (!result.success) throw new Error('invalid');
    const parsed = result.data;
    if (parsed.accountId !== input.accountId || parsed.query !== signature(input)) {
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
  signingKey: string,
): Promise<ThreadPageProjectionResult> {
  const cursor = input.cursor === undefined ? null : decode(input.cursor, input, signingKey);
  const requiredMailboxIds = [
    ...new Set([
      ...(input.mailboxId === undefined ? [] : [input.mailboxId]),
      ...(input.hasMailboxIds ?? []),
    ]),
  ];
  if (requiredMailboxIds.length > 0) {
    const owned = await db
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.mailAccountId, input.accountId),
          inArray(mailbox.id, requiredMailboxIds),
          isNull(mailbox.deletedAt),
        ),
      );
    const ownedIds = new Set(owned.map(({ id }) => id));
    const unresolvedIds = requiredMailboxIds.filter((id) => !ownedIds.has(id));
    if (unresolvedIds.length > 0) {
      const outside = await db
        .select({ id: mailbox.id })
        .from(mailbox)
        .where(and(inArray(mailbox.id, unresolvedIds), ne(mailbox.mailAccountId, input.accountId)))
        .limit(1);
      throw new MailCoreError(outside.length > 0 ? 'CROSS_ACCOUNT_REFERENCE' : 'MAILBOX_NOT_FOUND');
    }
  }
  const membership = and(
    ...requiredMailboxIds.map((mailboxId) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(mailboxThread)
          .where(
            and(
              eq(mailboxThread.mailAccountId, input.accountId),
              eq(mailboxThread.mailboxId, mailboxId),
              eq(mailboxThread.threadId, thread.id),
            ),
          ),
      ),
    ),
  );
  const requiredKeywords = [
    ...new Set([
      ...(input.hasKeyword === undefined ? [] : [input.hasKeyword]),
      ...(input.hasKeywords ?? []),
    ]),
  ];
  const hasKeyword = (keyword: string) =>
    keyword === CRM_CUSTOMER_KEYWORD
      ? exists(
          db
            .select({ one: sql`1` })
            .from(crmCustomerMarker)
            .where(
              and(
                eq(crmCustomerMarker.mailAccountId, input.accountId),
                eq(crmCustomerMarker.emailId, email.id),
              ),
            ),
        )
      : exists(
          db
            .select({ one: sql`1` })
            .from(emailKeyword)
            .where(
              and(
                eq(emailKeyword.mailAccountId, input.accountId),
                eq(emailKeyword.emailId, email.id),
                eq(emailKeyword.keyword, keyword),
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
          exists(
            db
              .select({ one: sql`1` })
              .from(emailMailbox)
              .where(
                and(
                  eq(emailMailbox.mailAccountId, input.accountId),
                  eq(emailMailbox.emailId, email.id),
                ),
              ),
          ),
          input.lifecycle === undefined ? undefined : eq(email.lifecycle, input.lifecycle),
          ...requiredKeywords.map(hasKeyword),
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
  const activeSnooze = exists(
    db
      .select({ one: sql`1` })
      .from(threadSnooze)
      .where(
        and(
          eq(threadSnooze.mailAccountId, input.accountId),
          eq(threadSnooze.threadId, thread.id),
          inArray(threadSnooze.status, ['scheduled', 'waking']),
        ),
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
        input.unreadOnly ? gt(thread.unreadCount, 0) : undefined,
        position,
        input.snoozed === undefined ? undefined : input.snoozed ? activeSnooze : not(activeSnooze),
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
        exists(
          db
            .select({ one: sql`1` })
            .from(emailMailbox)
            .where(
              and(
                eq(emailMailbox.mailAccountId, input.accountId),
                eq(emailMailbox.emailId, email.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(email.receivedAt), asc(email.id));
  const emailIds = new Map<string, string[]>();
  const latest = new Map<string, (typeof emails)[number]>();
  for (const item of emails) {
    emailIds.set(item.threadId, [...(emailIds.get(item.threadId) ?? []), item.id]);
    latest.set(item.threadId, item);
  }
  const allEmailIds = emails.map(({ id }) => id);
  const threadByEmailId = new Map(emails.map(({ id, threadId }) => [id, threadId]));
  const latestEmailIds = [...latest.values()].map(({ id }) => id);
  const [mailboxes, keywords, customerMarkers, recipients] = await Promise.all([
    db
      .select({ emailId: emailMailbox.emailId, value: emailMailbox.mailboxId })
      .from(emailMailbox)
      .where(
        and(
          eq(emailMailbox.mailAccountId, input.accountId),
          inArray(emailMailbox.emailId, allEmailIds),
        ),
      ),
    db
      .select({ emailId: emailKeyword.emailId, value: emailKeyword.keyword })
      .from(emailKeyword)
      .where(
        and(
          eq(emailKeyword.mailAccountId, input.accountId),
          inArray(emailKeyword.emailId, allEmailIds),
        ),
      ),
    db
      .select({
        emailId: crmCustomerMarker.emailId,
        customerId: crmCustomerMarker.customerId,
        customerName: crmCustomerMarker.customerName,
      })
      .from(crmCustomerMarker)
      .where(
        and(
          eq(crmCustomerMarker.mailAccountId, input.accountId),
          inArray(crmCustomerMarker.emailId, allEmailIds),
        ),
      ),
    db
      .select({
        emailId: emailAddress.emailId,
        name: emailAddress.name,
        email: emailAddress.address,
        position: emailAddress.position,
      })
      .from(emailAddress)
      .where(
        and(
          eq(emailAddress.mailAccountId, input.accountId),
          inArray(emailAddress.emailId, latestEmailIds),
          eq(emailAddress.kind, 'to'),
        ),
      )
      .orderBy(asc(emailAddress.position)),
  ]);
  const mapValues = (rows: Array<{ emailId: string; value: string }>, threadId: string) =>
    Object.fromEntries(
      rows
        .filter((row) => threadByEmailId.get(row.emailId) === threadId)
        .map(({ value }) => [value, true as const]),
    ) as Record<string, true>;
  const recipientsByEmailId = new Map<string, Array<{ name: string | null; email: string }>>();
  for (const { emailId, name, email: address } of recipients) {
    const values = recipientsByEmailId.get(emailId);
    if (values) values.push({ name, email: address });
    else recipientsByEmailId.set(emailId, [{ name, email: address }]);
  }
  const items = page.flatMap((row) => {
    const latestEmail = latest.get(row.id);
    if (latestEmail === undefined) return [];
    const threadCustomerMarkers = Array.from(
      new Map(
        customerMarkers
          .filter(({ emailId }) => threadByEmailId.get(emailId) === row.id)
          .map(({ customerId, customerName }) => [customerId, { customerId, customerName }]),
      ).values(),
    );
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
        mailboxIds: mapValues(mailboxes, row.id),
        keywords: {
          ...mapValues(keywords, row.id),
          ...(threadCustomerMarkers.length > 0 ? { [CRM_CUSTOMER_KEYWORD]: true as const } : {}),
        },
        customerMarkers: threadCustomerMarkers,
        latestEmail: {
          id: latestEmail.id,
          lifecycle: latestEmail.lifecycle,
          receivedAt: latestEmail.receivedAt.toISOString(),
          to: recipientsByEmailId.get(latestEmail.id) ?? [],
        },
      },
    ];
  });
  const last = page.at(-1);
  return {
    items,
    cursor:
      rows.length > input.limit && last !== undefined
        ? encode(
            {
              version: 1,
              accountId: input.accountId,
              query: signature(input),
              latestReceivedAt: last.latestReceivedAt.toISOString(),
              threadId: last.id,
            },
            signingKey,
          )
        : null,
  };
}
