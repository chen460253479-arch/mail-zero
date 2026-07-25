import type {
  EmailRecord,
  MailCoreDependencies,
  SearchEmailCursor,
  SearchEmailInput,
  SearchEmailResult,
  SearchStore,
} from '../store';
import { createMemoryMailInspector, MemoryMailUnitOfWork } from './memory-mail-store';
import type { EmailId, Id, MailAccountId } from '../types';
import { MemoryBlobStore } from './memory-blob-store';
import type { CursorSortValue } from '../search';

export interface CreateMemoryMailCoreDependenciesOptions {
  corruptBlobOnCommit?: 'sha256' | 'size';
  failBlobCommit?: boolean;
  now?: Date;
  sanitizeHtml?: (html: string) => string;
}

export class MemoryClock {
  private current: Date;

  constructor(now = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(now);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(now: Date): void {
    this.current = new Date(now);
  }
}

export class MemorySearchStore implements SearchStore {
  constructor(private readonly unitOfWork: MemoryMailUnitOfWork) {}

  async query(input: SearchEmailInput): Promise<SearchEmailResult> {
    const normalize = (value: string): string =>
      value.trim().normalize('NFC').toLocaleLowerCase('und');
    const addressFields = (email: EmailRecord) => [
      ...email.sender,
      ...email.from,
      ...email.replyTo,
      ...email.to,
      ...email.cc,
      ...email.bcc,
    ];
    const state = this.unitOfWork.snapshot();
    const candidates = [...state.emails.values()]
      .filter((email) => email.accountId === input.accountId && email.destroyedAt === null)
      .map((email) => ({
        email,
        document: state.emailSearchDocuments.get(`${email.accountId}\u0000${email.id}`),
      }));
    const filtered = candidates
      .filter(({ email, document }) => {
        if (email.accountId !== input.accountId || email.destroyedAt !== null) {
          return false;
        }
        const filter = input.filter;
        return (
          (filter.mailboxId === undefined || email.mailboxIds.includes(filter.mailboxId)) &&
          (filter.hasKeyword === undefined || email.keywords.includes(filter.hasKeyword)) &&
          (filter.after === undefined || email.receivedAt > filter.after) &&
          (filter.before === undefined || email.receivedAt < filter.before) &&
          (filter.address === undefined ||
            addressFields(email).some(
              ({ email: address }) => normalize(address) === filter.address,
            )) &&
          (filter.hasAttachment === undefined || email.hasAttachment === filter.hasAttachment) &&
          (filter.text === undefined ||
            normalize(
              [
                document?.subject ?? email.subject,
                document?.addressText ?? '',
                document?.bodyText ?? email.preview,
              ].join(' '),
            ).includes(filter.text))
        );
      })
      .map(({ email }) => email);

    const valueOf = (email: EmailRecord): CursorSortValue => {
      switch (input.sort.property) {
        case 'receivedAt':
          return { type: 'date', value: email.receivedAt.toISOString() };
        case 'sentAt':
          return email.sentAt === null
            ? { type: 'null' }
            : { type: 'date', value: email.sentAt.toISOString() };
        case 'size':
          return { type: 'bigint', value: email.sizeBytes.toString() };
        case 'subject':
          return { type: 'string', value: normalize(email.subject) };
      }
    };

    const compareValues = (left: CursorSortValue, right: CursorSortValue): number => {
      if (left.type === 'null' || right.type === 'null') {
        if (left.type === right.type) {
          return 0;
        }
        return left.type === 'null' ? 1 : -1;
      }
      let comparison: number;
      if (left.type === 'bigint' && right.type === 'bigint') {
        const leftValue = BigInt(left.value);
        const rightValue = BigInt(right.value);
        comparison = leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
      } else if (
        (left.type === 'date' && right.type === 'date') ||
        (left.type === 'string' && right.type === 'string')
      ) {
        comparison = left.value.localeCompare(right.value);
      } else {
        return left.type.localeCompare(right.type);
      }
      return input.sort.direction === 'asc' ? comparison : -comparison;
    };

    const comparePosition = (
      left: Pick<SearchEmailCursor, 'emailId' | 'value'>,
      right: Pick<SearchEmailCursor, 'emailId' | 'value'>,
    ): number => {
      const valueComparison = compareValues(left.value, right.value);
      return valueComparison === 0 ? left.emailId.localeCompare(right.emailId) : valueComparison;
    };

    const ordered = filtered
      .map((email) => ({
        emailId: email.id,
        value: valueOf(email),
      }))
      .sort(comparePosition)
      .filter((position) => input.cursor === null || comparePosition(position, input.cursor) > 0);
    const page = ordered.slice(0, input.limit);
    const hasMore = ordered.length > input.limit;
    return {
      emailIds: page.map(({ emailId }) => emailId),
      nextCursor: hasMore ? page.at(-1)! : null,
    };
  }
}

export const createMemoryMailCoreDependencies = (
  options: CreateMemoryMailCoreDependenciesOptions = {},
) => {
  const unitOfWork = new MemoryMailUnitOfWork();
  const blobStore = new MemoryBlobStore({
    corruptOnCommit: options.corruptBlobOnCommit,
    failCommit: options.failBlobCommit,
  });
  const searchStore = new MemorySearchStore(unitOfWork);
  const clock = new MemoryClock(options.now);
  const baseInspector = createMemoryMailInspector(unitOfWork);
  let nextId = 1;

  const dependencies: MailCoreDependencies = {
    unitOfWork,
    blobStore,
    searchStore,
    clock,
    idFactory: {
      next<Kind extends string>() {
        const id = `id-${nextId.toString().padStart(8, '0')}` as Id<Kind>;
        nextId += 1;
        return id;
      },
    },
    sanitizeHtml: options.sanitizeHtml ?? ((html) => html),
  };

  return {
    ...dependencies,
    unitOfWork,
    blobStore,
    searchStore,
    clock,
    inspect: {
      ...baseInspector,
      async rawBytes(emailId: EmailId): Promise<Uint8Array | null> {
        const email = await baseInspector.email(emailId);
        if (email?.blobId === null || email?.blobId === undefined) {
          return null;
        }
        const blob = await baseInspector.blob(email.blobId);
        return blob === null ? null : blobStore.get(blob.objectKey);
      },
      async stateVersion(accountId: MailAccountId): Promise<bigint> {
        return baseInspector.stateVersion(accountId);
      },
    },
  };
};
