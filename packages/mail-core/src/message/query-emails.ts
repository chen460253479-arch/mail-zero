import {
  decodeCursor,
  encodeCursor,
  type CursorSortValue,
  type EmailQueryFilter,
  type EmailQuerySort,
} from '../search';
import { MailCoreError, normalizeKeyword, type EmailId, type MailAccountId } from '../types';
import type { MailCoreDependencies, SearchEmailCursor } from '../store';

const MAX_QUERY_LIMIT = 1000;

export type QueryEmailsInput = {
  accountId: MailAccountId;
  filter?: EmailQueryFilter;
  sort?: EmailQuerySort;
  limit: number;
  cursor: string | null;
  calculateTotal?: boolean;
};

export type EmailQueryResult = {
  emailIds: EmailId[];
  nextCursor: string | null;
  appliedFilter: EmailQueryFilter;
  appliedSort: EmailQuerySort;
  total: number | null;
};

export const normalizeSearchText = (value: string): string =>
  value.trim().normalize('NFC').toLocaleLowerCase('und');

const validDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const normalizeFilter = (filter: EmailQueryFilter | undefined): EmailQueryFilter => {
  const normalized: EmailQueryFilter = {};
  if (filter?.mailboxId !== undefined) {
    normalized.mailboxId = filter.mailboxId;
  }
  if (filter?.hasKeyword !== undefined) {
    normalized.hasKeyword = normalizeKeyword(filter.hasKeyword);
  }
  if (filter?.notKeyword !== undefined) {
    normalized.notKeyword = normalizeKeyword(filter.notKeyword);
  }
  if (filter?.lifecycle !== undefined) {
    if (!['draft', 'received', 'sent'].includes(filter.lifecycle)) {
      throw new MailCoreError('INVALID_QUERY');
    }
    normalized.lifecycle = filter.lifecycle;
  }
  if (filter?.after !== undefined) {
    if (!(filter.after instanceof Date) || !validDate(filter.after)) {
      throw new MailCoreError('INVALID_QUERY');
    }
    normalized.after = new Date(filter.after);
  }
  if (filter?.before !== undefined) {
    if (!(filter.before instanceof Date) || !validDate(filter.before)) {
      throw new MailCoreError('INVALID_QUERY');
    }
    normalized.before = new Date(filter.before);
  }
  if (
    normalized.after !== undefined &&
    normalized.before !== undefined &&
    normalized.after >= normalized.before
  ) {
    throw new MailCoreError('INVALID_QUERY');
  }
  if (filter?.address !== undefined) {
    const address = normalizeSearchText(filter.address);
    if (address.length === 0) {
      throw new MailCoreError('INVALID_QUERY');
    }
    normalized.address = address;
  }
  for (const property of ['from', 'to'] as const) {
    if (filter?.[property] === undefined) {
      continue;
    }
    const address = normalizeSearchText(filter[property]);
    if (address.length === 0) {
      throw new MailCoreError('INVALID_QUERY');
    }
    normalized[property] = address;
  }
  if (filter?.hasAttachment !== undefined) {
    if (typeof filter.hasAttachment !== 'boolean') {
      throw new MailCoreError('INVALID_QUERY');
    }
    normalized.hasAttachment = filter.hasAttachment;
  }
  if (filter?.text !== undefined) {
    const text = normalizeSearchText(filter.text);
    if (text.length === 0) {
      throw new MailCoreError('INVALID_QUERY');
    }
    normalized.text = text;
  }
  return normalized;
};

const normalizeSort = (sort: EmailQuerySort | undefined): EmailQuerySort => {
  const normalized = sort ?? { property: 'receivedAt', direction: 'desc' };
  if (
    !['receivedAt', 'sentAt', 'size', 'subject'].includes(normalized.property) ||
    !['asc', 'desc'].includes(normalized.direction)
  ) {
    throw new MailCoreError('INVALID_QUERY');
  }
  return { ...normalized };
};

const querySignature = (filter: EmailQueryFilter): string =>
  JSON.stringify({
    mailboxId: filter.mailboxId ?? null,
    hasKeyword: filter.hasKeyword ?? null,
    notKeyword: filter.notKeyword ?? null,
    lifecycle: filter.lifecycle ?? null,
    after: filter.after?.toISOString() ?? null,
    before: filter.before?.toISOString() ?? null,
    address: filter.address ?? null,
    from: filter.from ?? null,
    to: filter.to ?? null,
    hasAttachment: filter.hasAttachment ?? null,
    text: filter.text ?? null,
  });

const valueMatchesSort = (sort: EmailQuerySort['property'], value: CursorSortValue): boolean => {
  switch (sort) {
    case 'receivedAt':
      return value.type === 'date';
    case 'sentAt':
      return value.type === 'date' || value.type === 'null';
    case 'size':
      return value.type === 'bigint';
    case 'subject':
      return value.type === 'string';
  }
};

const validateCursor = (
  encoded: string | null,
  accountId: MailAccountId,
  filter: EmailQueryFilter,
  sort: EmailQuerySort,
  signingKey: string,
): SearchEmailCursor | null => {
  if (encoded === null) {
    return null;
  }
  const payload = decodeCursor(encoded, accountId, signingKey);
  if (
    payload.kind !== 'email' ||
    payload.sort !== sort.property ||
    payload.direction !== sort.direction ||
    payload.query !== querySignature(filter) ||
    !valueMatchesSort(sort.property, payload.value)
  ) {
    throw new MailCoreError('INVALID_CURSOR');
  }
  return { value: payload.value, emailId: payload.emailId };
};

export async function queryEmails(
  dependencies: Pick<MailCoreDependencies, 'cursorSigningKey' | 'searchStore' | 'unitOfWork'>,
  input: QueryEmailsInput,
): Promise<EmailQueryResult> {
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > MAX_QUERY_LIMIT) {
    throw new MailCoreError('INVALID_QUERY');
  }
  const filter = normalizeFilter(input.filter);
  const sort = normalizeSort(input.sort);
  const cursor = validateCursor(
    input.cursor,
    input.accountId,
    filter,
    sort,
    dependencies.cursorSigningKey,
  );

  await dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    if (filter.mailboxId !== undefined) {
      const mailbox = await tx.mailboxes.findById(input.accountId, filter.mailboxId);
      if (mailbox === null || mailbox.deletedAt !== null) {
        if (await tx.mailboxes.existsOutsideAccount(input.accountId, filter.mailboxId)) {
          throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', {
            entityId: filter.mailboxId,
          });
        }
        throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: filter.mailboxId });
      }
    }
  });

  const result = await dependencies.searchStore.query({
    accountId: input.accountId,
    filter,
    sort,
    limit: input.limit,
    cursor,
    calculateTotal: input.calculateTotal ?? false,
  });
  return {
    emailIds: result.emailIds,
    nextCursor:
      result.nextCursor === null
        ? null
        : encodeCursor(
            {
              version: 1,
              kind: 'email',
              accountId: input.accountId,
              sort: sort.property,
              direction: sort.direction,
              query: querySignature(filter),
              value: result.nextCursor.value,
              emailId: result.nextCursor.emailId,
            },
            dependencies.cursorSigningKey,
          ),
    appliedFilter: filter,
    appliedSort: sort,
    total: result.total,
  };
}
