import type {
  EmailRecord,
  MailCoreDependencies,
  MailTransaction,
  ThreadQueryProjection,
  ThreadRecord,
} from '../store';
import { MailCoreError, type MailAccountId, type MailboxId, type ThreadId } from '../types';
import { decodeCursor, encodeCursor } from '../search';

const MAX_QUERY_LIMIT = 1000;

export type ThreadQueryItem = ThreadRecord & {
  emailIds: EmailRecord['id'][];
};

export type QueryThreadsInput = {
  accountId: MailAccountId;
  mailboxId?: MailboxId;
  limit: number;
  cursor: string | null;
};

export type ThreadQueryResult = {
  threads: ThreadQueryItem[];
  nextCursor: string | null;
  appliedMailboxId: MailboxId | null;
};

export type GetThreadInput = {
  accountId: MailAccountId;
  threadId: ThreadId;
};

type ThreadPosition = {
  latestReceivedAt: Date;
  threadId: ThreadId;
};

const signature = (mailboxId: MailboxId | undefined): string =>
  JSON.stringify({ mailboxId: mailboxId ?? null });

const publicProjection = ({
  mailboxIds: _mailboxIds,
  ...thread
}: ThreadQueryProjection): ThreadQueryItem => thread;

const requireAccountAndMailbox = async (
  tx: MailTransaction,
  accountId: MailAccountId,
  mailboxId: MailboxId | undefined,
): Promise<void> => {
  if ((await tx.accounts.findById(accountId)) === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: accountId });
  }
  if (mailboxId === undefined) {
    return;
  }
  const mailbox = await tx.mailboxes.findById(accountId, mailboxId);
  if (mailbox !== null && mailbox.deletedAt === null) {
    return;
  }
  if (await tx.mailboxes.existsOutsideAccount(accountId, mailboxId)) {
    throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: mailboxId });
  }
  throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: mailboxId });
};

export async function queryThreads(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: QueryThreadsInput,
): Promise<ThreadQueryResult> {
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > MAX_QUERY_LIMIT) {
    throw new MailCoreError('INVALID_QUERY');
  }
  const query = signature(input.mailboxId);
  let cursor: ThreadPosition | null = null;
  if (input.cursor !== null) {
    const payload = decodeCursor(input.cursor, input.accountId);
    if (payload.kind !== 'thread' || payload.query !== query) {
      throw new MailCoreError('INVALID_CURSOR');
    }
    cursor = {
      latestReceivedAt: new Date(payload.latestReceivedAt),
      threadId: payload.threadId,
    };
  }

  return dependencies.unitOfWork.run(async (tx) => {
    await requireAccountAndMailbox(tx, input.accountId, input.mailboxId);
    const result = await tx.threadQueries.query({
      accountId: input.accountId,
      mailboxId: input.mailboxId ?? null,
      after: cursor,
      limit: input.limit,
    });
    const page = result.threads.map(publicProjection);
    const last = page.at(-1);
    return {
      threads: page,
      nextCursor:
        result.hasMore && last !== undefined
          ? encodeCursor({
              version: 1,
              kind: 'thread',
              accountId: input.accountId,
              query,
              latestReceivedAt: last.latestReceivedAt.toISOString(),
              threadId: last.id,
            })
          : null,
      appliedMailboxId: input.mailboxId ?? null,
    };
  });
}

export async function getThread(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: GetThreadInput,
): Promise<ThreadQueryItem> {
  return dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const thread = await tx.threadQueries.findById(input.accountId, input.threadId);
    if (thread === null) {
      if (await tx.threads.existsOutsideAccount(input.accountId, input.threadId)) {
        throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: input.threadId });
      }
      throw new MailCoreError('THREAD_NOT_FOUND', { entityId: input.threadId });
    }
    return publicProjection(thread);
  });
}
