import { describe, expect, it } from 'vitest';

import {
  buildThreadCategoryFilter,
  buildThreadDetailInput,
  buildThreadPageInput,
} from './thread-query-input';

describe('thread query input', () => {
  it('builds an account-scoped mailbox page without placing cursor in the filter key', () => {
    expect(
      buildThreadPageInput({
        accountId: 'account-1',
        route: { kind: 'mailbox', mailboxId: 'mailbox-inbox' },
        text: '  quarterly report  ',
        cursor: 'opaque-next-page',
      }),
    ).toEqual({
      accountId: 'account-1',
      mailboxId: 'mailbox-inbox',
      text: 'quarterly report',
      cursor: 'opaque-next-page',
      limit: 50,
    });
  });

  it('builds snoozed as a local view filter instead of a provider folder', () => {
    expect(
      buildThreadPageInput({
        accountId: 'account-1',
        route: { kind: 'snoozed' },
        text: '',
      }),
    ).toEqual({
      accountId: 'account-1',
      snoozed: true,
      limit: 50,
    });
  });

  it('maps built-in categories to local keyword and unread filters', () => {
    expect(buildThreadCategoryFilter('IMPORTANT')).toEqual({
      hasKeywords: ['$important'],
    });
    expect(buildThreadCategoryFilter('CUSTOMER')).toEqual({
      hasKeywords: ['customer'],
    });
    expect(buildThreadCategoryFilter('UNREAD')).toEqual({ unreadOnly: true });
  });

  it('maps custom category labels to mailbox and keyword filters', () => {
    expect(buildThreadCategoryFilter(' label-project , $flagged, label-project ')).toEqual({
      hasMailboxIds: ['label-project'],
      hasKeywords: ['$flagged'],
    });
  });

  it('includes the active category in the thread page request', () => {
    expect(
      buildThreadPageInput({
        accountId: 'account-1',
        route: { kind: 'mailbox', mailboxId: 'mailbox-inbox' },
        text: '',
        categorySearchValue: 'UNREAD',
      }),
    ).toEqual({
      accountId: 'account-1',
      mailboxId: 'mailbox-inbox',
      unreadOnly: true,
      limit: 50,
    });
  });

  it('rejects a not-found route before issuing a page request', () => {
    expect(() =>
      buildThreadPageInput({
        accountId: 'account-1',
        route: { kind: 'not-found' },
        text: '',
      }),
    ).toThrow('MAILBOX_ROUTE_NOT_FOUND');
  });

  it('requests body values only for an opened thread detail', () => {
    expect(buildThreadDetailInput('account-1', 'thread-1')).toEqual({
      accountId: 'account-1',
      threadId: 'thread-1',
      fetchTextBodyValues: true,
      fetchHTMLBodyValues: true,
      maxBodyValueBytes: 256_000,
    });
  });
});
