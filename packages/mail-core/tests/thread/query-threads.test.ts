import { describe, expect, it } from 'vitest';

import { createQueryHarness } from '../helpers/query-harness';
import { encodeCursor, queryThreads } from '../../src';

describe('queryThreads', () => {
  it('returns only visible Threads ordered by latest visible Email and chronological members', async () => {
    const h = await createQueryHarness();

    const result = await queryThreads(h.dependencies, {
      accountId: h.accountId,
      limit: 10,
      cursor: null,
    });

    expect(result.threads.map(({ id }) => id)).toEqual([h.threadB, h.threadA]);
    expect(result.threads[1]?.emailIds).toEqual([h.email1, h.email2, h.email3]);
    expect(result.threads[1]).toMatchObject({
      id: h.threadA,
      emailCount: 3,
      latestReceivedAt: new Date('2026-01-03T00:00:00.000Z'),
      preview: 'release three',
    });
  });

  it('does not scan account-wide Email and Thread repositories to produce a page', async () => {
    const h = await createQueryHarness();

    await queryThreads(h.dependencies, {
      accountId: h.accountId,
      limit: 1,
      cursor: null,
    });

    expect(h.repositoryCalls).toEqual({
      emailListByAccount: 0,
      threadListByAccount: 0,
    });
  });

  it('filters Threads by mailbox membership of visible member Emails', async () => {
    const h = await createQueryHarness();

    await expect(
      queryThreads(h.dependencies, {
        accountId: h.accountId,
        mailboxId: h.inboxId,
        limit: 10,
        cursor: null,
      }),
    ).resolves.toMatchObject({
      threads: [{ id: h.threadA, emailIds: [h.email1, h.email2, h.email3] }],
      appliedMailboxId: h.inboxId,
    });
  });

  it('keyset-pages without duplicates after a newer Thread is inserted', async () => {
    const h = await createQueryHarness();
    const input = {
      accountId: h.accountId,
      limit: 1,
      cursor: null,
    };
    const first = await queryThreads(h.dependencies, input);
    expect(first.threads.map(({ id }) => id)).toEqual([h.threadB]);

    await h.insertNewerThread();
    const second = await queryThreads(h.dependencies, {
      ...input,
      cursor: first.nextCursor,
    });

    expect(second.threads.map(({ id }) => id)).toEqual([h.threadA]);
  });

  it('rejects Email, cross-account, malformed, and query-mismatched cursors safely', async () => {
    const h = await createQueryHarness();
    const first = await queryThreads(h.dependencies, {
      accountId: h.accountId,
      limit: 1,
      cursor: null,
    });
    const emailCursor = encodeCursor({
      version: 1,
      kind: 'email',
      accountId: h.accountId,
      sort: 'receivedAt',
      direction: 'desc',
      query: 'email',
      value: { type: 'date', value: '2026-01-01T00:00:00.000Z' },
      emailId: h.email1,
    });
    const crossAccountCursor = encodeCursor({
      version: 1,
      kind: 'thread',
      accountId: h.otherAccountId,
      query: 'thread',
      latestReceivedAt: '2026-01-01T00:00:00.000Z',
      threadId: h.threadA,
    });

    await expect(
      queryThreads(h.dependencies, {
        accountId: h.accountId,
        limit: 1,
        cursor: emailCursor,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      queryThreads(h.dependencies, {
        accountId: h.accountId,
        limit: 1,
        cursor: crossAccountCursor,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
    await expect(
      queryThreads(h.dependencies, {
        accountId: h.accountId,
        limit: 1,
        cursor: 'malformed!',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      queryThreads(h.dependencies, {
        accountId: h.accountId,
        mailboxId: h.archiveId,
        limit: 1,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
});
