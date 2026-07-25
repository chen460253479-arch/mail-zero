import type {
  CursorSortValue,
  EmailId,
  SearchEmailCursor,
  SearchEmailInput,
  SearchEmailResult,
  SearchStore,
} from '@zero/mail-core';
import { sql, type SQL } from 'drizzle-orm';

import { email, emailAddress, emailKeyword, emailMailbox, emailSearch } from '../postgres/schema';
import { runAdapter } from '../postgres/repositories/database';
import type { DB } from '../../../db';

type ResultRow = {
  id: string;
  sort_value: Date | bigint | number | string | null;
};

const subjectExpression = sql`lower(normalize(btrim(coalesce(${email.subject}, '')), NFC))`;

const sortExpression = (input: SearchEmailInput): SQL => {
  switch (input.sort.property) {
    case 'receivedAt':
      return sql`${email.receivedAt}`;
    case 'sentAt':
      return sql`${email.sentAt}`;
    case 'size':
      return sql`${email.sizeBytes}`;
    case 'subject':
      return subjectExpression;
  }
};

const cursorValue = (input: SearchEmailInput, cursor: SearchEmailCursor): unknown => {
  switch (input.sort.property) {
    case 'receivedAt':
    case 'sentAt':
      return cursor.value.type === 'date' ? cursor.value.value : null;
    case 'size':
      return cursor.value.type === 'bigint' ? BigInt(cursor.value.value) : null;
    case 'subject':
      return cursor.value.type === 'string' ? cursor.value.value : null;
  }
};

const keysetPredicate = (input: SearchEmailInput, expression: SQL): SQL | null => {
  if (input.cursor === null) return null;
  const value = cursorValue(input, input.cursor);
  if (input.sort.property === 'sentAt' && input.cursor.value.type === 'null') {
    return sql`(${email.sentAt} IS NULL AND ${email.id} > ${input.cursor.emailId})`;
  }
  const comparison =
    input.sort.direction === 'asc' ? sql`${expression} > ${value}` : sql`${expression} < ${value}`;
  const nonNullPosition = sql`(${comparison} OR (${expression} = ${value} AND ${email.id} > ${input.cursor.emailId}))`;
  return input.sort.property === 'sentAt'
    ? sql`(${nonNullPosition} OR ${email.sentAt} IS NULL)`
    : nonNullPosition;
};

const resultValue = (
  property: SearchEmailInput['sort']['property'],
  value: ResultRow['sort_value'],
): CursorSortValue => {
  switch (property) {
    case 'receivedAt':
      return {
        type: 'date',
        value: (value instanceof Date ? value : new Date(String(value))).toISOString(),
      };
    case 'sentAt':
      return value === null
        ? { type: 'null' }
        : {
            type: 'date',
            value: (value instanceof Date ? value : new Date(String(value))).toISOString(),
          };
    case 'size':
      return { type: 'bigint', value: BigInt(String(value)).toString() };
    case 'subject':
      return { type: 'string', value: String(value ?? '') };
  }
};

const predicatesFor = (input: SearchEmailInput): SQL[] => {
  const filter = input.filter;
  return [
    sql`${email.mailAccountId} = ${input.accountId}`,
    sql`${email.destroyedAt} IS NULL`,
    ...(filter.mailboxId === undefined
      ? []
      : [
          sql`EXISTS (
            SELECT 1 FROM ${emailMailbox}
            WHERE ${emailMailbox.mailAccountId} = ${input.accountId}
              AND ${emailMailbox.emailId} = ${email.id}
              AND ${emailMailbox.mailboxId} = ${filter.mailboxId}
          )`,
        ]),
    ...(filter.hasKeyword === undefined
      ? []
      : [
          sql`EXISTS (
            SELECT 1 FROM ${emailKeyword}
            WHERE ${emailKeyword.mailAccountId} = ${input.accountId}
              AND ${emailKeyword.emailId} = ${email.id}
              AND ${emailKeyword.keyword} = ${filter.hasKeyword}
          )`,
        ]),
    ...(filter.after === undefined
      ? []
      : [sql`${email.receivedAt} > ${filter.after.toISOString()}`]),
    ...(filter.before === undefined
      ? []
      : [sql`${email.receivedAt} < ${filter.before.toISOString()}`]),
    ...(filter.address === undefined
      ? []
      : [
          sql`EXISTS (
            SELECT 1 FROM ${emailAddress}
            WHERE ${emailAddress.mailAccountId} = ${input.accountId}
              AND ${emailAddress.emailId} = ${email.id}
              AND lower(normalize(btrim(${emailAddress.address}), NFC)) = ${filter.address}
          )`,
        ]),
    ...(filter.hasAttachment === undefined
      ? []
      : [sql`${email.hasAttachment} = ${filter.hasAttachment}`]),
    ...(filter.text === undefined
      ? []
      : [
          sql`EXISTS (
            SELECT 1 FROM ${emailSearch}
            WHERE ${emailSearch.mailAccountId} = ${input.accountId}
              AND ${emailSearch.emailId} = ${email.id}
              AND ${emailSearch.document} @@ websearch_to_tsquery('simple', ${filter.text})
          )`,
        ]),
  ];
};

export class PostgresSearchStore implements SearchStore {
  constructor(private readonly db: DB) {}

  query(input: SearchEmailInput): Promise<SearchEmailResult> {
    return runAdapter(async () => {
      const expression = sortExpression(input);
      const keyset = keysetPredicate(input, expression);
      const predicates = [...predicatesFor(input), ...(keyset === null ? [] : [keyset])];
      const direction = input.sort.direction === 'asc' ? sql.raw('ASC') : sql.raw('DESC');
      const nulls = input.sort.property === 'sentAt' ? sql.raw(' NULLS LAST') : sql.empty();
      const rows = (await this.db.execute(sql`
        SELECT ${email.id} AS id, ${expression} AS sort_value
        FROM ${email}
        WHERE ${sql.join(predicates, sql.raw(' AND '))}
        ORDER BY ${expression} ${direction}${nulls}, ${email.id} ASC
        LIMIT ${input.limit + 1}
      `)) as unknown as ResultRow[];
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        emailIds: page.map(({ id }) => id as EmailId),
        nextCursor:
          hasMore && last !== undefined
            ? {
                emailId: last.id as EmailId,
                value: resultValue(input.sort.property, last.sort_value),
              }
            : null,
      };
    });
  }
}
