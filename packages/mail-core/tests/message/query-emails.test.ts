import { describe, expect, it } from 'vitest';

import { encodeCursor, queryEmails, type EmailCursorPayload, type MailboxId } from '../../src';
import { createQueryHarness } from '../helpers/query-harness';

describe('queryEmails', () => {
  it('searches full body text beyond the Email preview through the real memory SearchStore', async () => {
    const h = await createQueryHarness();
    const objectKey = await h.insertBodySearchEmail();
    await h.dependencies.blobStore.delete({
      accountId: h.accountId,
      objectKey,
    });

    const result = await queryEmails(h.dependencies, {
      accountId: h.accountId,
      filter: { text: 'ultrasecretterm' },
      sort: { property: 'receivedAt', direction: 'asc' },
      limit: 20,
      cursor: null,
    });

    expect(result.emailIds).toEqual(['email-body-search']);
  });

  it('never reads another account body blobs while searching text', async () => {
    const h = await createQueryHarness();
    await h.insertBodySearchEmail();
    await h.insertForeignBrokenBodyEmail();

    await expect(
      queryEmails(h.dependencies, {
        accountId: h.accountId,
        filter: { text: 'ultrasecretterm' },
        sort: { property: 'receivedAt', direction: 'asc' },
        limit: 20,
        cursor: null,
      }),
    ).resolves.toMatchObject({ emailIds: ['email-body-search'] });
  });

  it.each([
    ['mailbox', { mailboxId: 'mailbox-inbox' as MailboxId }, ['email-1', 'email-2', 'email-3']],
    ['keyword', { hasKeyword: '$seen' }, ['email-1', 'email-2', 'email-3', 'email-6']],
    [
      'exclusive after',
      { after: new Date('2026-01-01T00:00:00.000Z') },
      ['email-2', 'email-3', 'email-4', 'email-6'],
    ],
    [
      'exclusive before',
      { before: new Date('2026-01-04T00:00:00.000Z') },
      ['email-1', 'email-2', 'email-3'],
    ],
    [
      'normalized address',
      { address: '  SENDER@EXAMPLE.TEST  ' },
      ['email-1', 'email-2', 'email-3', 'email-4'],
    ],
    ['normalized from', { from: '  SENDER@EXAMPLE.TEST  ' }, ['email-1', 'email-2']],
    ['normalized to', { to: '  SENDER@EXAMPLE.TEST  ' }, ['email-4']],
    ['attachment', { hasAttachment: true }, ['email-1', 'email-2', 'email-3']],
    ['text', { text: '  RELEASE  ' }, ['email-1', 'email-2', 'email-3']],
  ] as const)('applies the %s filter through SearchStore', async (_label, filter, expected) => {
    const h = await createQueryHarness();

    const result = await queryEmails(h.dependencies, {
      accountId: h.accountId,
      filter,
      sort: { property: 'receivedAt', direction: 'asc' },
      limit: 20,
      cursor: null,
    });

    expect(result.emailIds).toEqual(expected);
    expect(result.appliedFilter.address).toBe(
      'address' in filter ? 'sender@example.test' : undefined,
    );
    expect(result.appliedFilter.from).toBe('from' in filter ? 'sender@example.test' : undefined);
    expect(result.appliedFilter.to).toBe('to' in filter ? 'sender@example.test' : undefined);
    expect(result.appliedFilter.text).toBe('text' in filter ? 'release' : undefined);
  });

  it.each([
    [
      'receivedAt desc',
      { property: 'receivedAt', direction: 'desc' },
      ['email-6', 'email-4', 'email-3', 'email-2', 'email-1'],
    ],
    [
      'sentAt asc',
      { property: 'sentAt', direction: 'asc' },
      ['email-3', 'email-2', 'email-1', 'email-4', 'email-6'],
    ],
    [
      'sentAt desc',
      { property: 'sentAt', direction: 'desc' },
      ['email-2', 'email-3', 'email-1', 'email-4', 'email-6'],
    ],
    [
      'size asc',
      { property: 'size', direction: 'asc' },
      ['email-1', 'email-6', 'email-2', 'email-4', 'email-3'],
    ],
    [
      'subject asc',
      { property: 'subject', direction: 'asc' },
      ['email-2', 'email-4', 'email-1', 'email-3', 'email-6'],
    ],
  ] as const)(
    'sorts by %s with deterministic ID ties and null sentAt last',
    async (_label, sort, expected) => {
      const h = await createQueryHarness();

      const result = await queryEmails(h.dependencies, {
        accountId: h.accountId,
        filter: {},
        sort,
        limit: 20,
        cursor: null,
      });

      expect(result.emailIds).toEqual(expected);
      expect(result.appliedSort).toEqual(sort);
    },
  );

  it('keyset-pages without duplicating or skipping pre-existing rows after newer insertion', async () => {
    const h = await createQueryHarness();
    const input = {
      accountId: h.accountId,
      filter: { mailboxId: h.inboxId },
      sort: { property: 'receivedAt' as const, direction: 'desc' as const },
      limit: 2,
      cursor: null,
    };
    const first = await queryEmails(h.dependencies, input);
    expect(first.emailIds).toEqual([h.email3, h.email2]);

    await h.insertNewerMatchingEmail();
    const second = await queryEmails(h.dependencies, {
      ...input,
      filter: first.appliedFilter,
      sort: first.appliedSort,
      cursor: first.nextCursor,
    });

    expect(second.emailIds).toEqual([h.email1]);
    expect(new Set([...first.emailIds, ...second.emailIds]).size).toBe(3);
  });

  it('uses the Email ID tie-breaker when an equal-key row is inserted between pages', async () => {
    const h = await createQueryHarness();
    const input = {
      accountId: h.accountId,
      filter: { mailboxId: h.inboxId },
      sort: { property: 'receivedAt' as const, direction: 'asc' as const },
      limit: 2,
      cursor: null,
    };
    const first = await queryEmails(h.dependencies, input);
    expect(first.emailIds).toEqual([h.email1, h.email2]);

    await h.insertEqualKeyEmail();
    const second = await queryEmails(h.dependencies, {
      ...input,
      cursor: first.nextCursor,
    });

    expect(second.emailIds).toEqual(['email-25', h.email3]);
  });

  it.each([0, -1, 1.5, 1001])(
    'rejects invalid bounded limit %j without mutation',
    async (limit) => {
      const h = await createQueryHarness();
      const before = await h.dependencies.inspect.stateVersion(h.accountId);

      await expect(
        queryEmails(h.dependencies, {
          accountId: h.accountId,
          filter: {},
          sort: { property: 'receivedAt', direction: 'desc' },
          limit,
          cursor: null,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
      expect(await h.dependencies.inspect.stateVersion(h.accountId)).toBe(before);
      expect(await h.dependencies.inspect.changes(h.accountId)).toEqual([]);
    },
  );

  it('binds a cursor to its exact kind, sort, direction, and canonical filter signature', async () => {
    const h = await createQueryHarness();
    const first = await queryEmails(h.dependencies, {
      accountId: h.accountId,
      filter: { mailboxId: h.inboxId },
      sort: { property: 'receivedAt', direction: 'desc' },
      limit: 1,
      cursor: null,
    });

    for (const input of [
      {
        filter: { mailboxId: h.archiveId },
        sort: { property: 'receivedAt' as const, direction: 'desc' as const },
      },
      {
        filter: { mailboxId: h.inboxId },
        sort: { property: 'subject' as const, direction: 'desc' as const },
      },
      {
        filter: { mailboxId: h.inboxId },
        sort: { property: 'receivedAt' as const, direction: 'asc' as const },
      },
    ]) {
      await expect(
        queryEmails(h.dependencies, {
          accountId: h.accountId,
          ...input,
          limit: 1,
          cursor: first.nextCursor,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CURSOR', details: {} });
    }

    const threadCursor = encodeCursor({
      version: 1,
      kind: 'thread',
      accountId: h.accountId,
      query: 'thread-query',
      latestReceivedAt: '2026-01-01T00:00:00.000Z',
      threadId: h.threadA,
    });
    await expect(
      queryEmails(h.dependencies, {
        accountId: h.accountId,
        filter: { mailboxId: h.inboxId },
        sort: { property: 'receivedAt', direction: 'desc' },
        limit: 1,
        cursor: threadCursor,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR', details: {} });
  });

  it('rejects a structurally valid cross-account cursor before SearchStore execution', async () => {
    const h = await createQueryHarness();
    const cursor = encodeCursor({
      version: 1,
      kind: 'email',
      accountId: h.otherAccountId,
      sort: 'receivedAt',
      direction: 'desc',
      query: 'anything',
      value: { type: 'date', value: '2026-01-01T00:00:00.000Z' },
      emailId: 'email-other',
    } as EmailCursorPayload);

    await expect(
      queryEmails(h.dependencies, {
        accountId: h.accountId,
        filter: {},
        sort: { property: 'receivedAt', direction: 'desc' },
        limit: 1,
        cursor,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE', details: {} });
  });
});
