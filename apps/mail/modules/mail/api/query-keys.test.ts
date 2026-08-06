import { describe, expect, it } from 'vitest';
import { mailQueryKeys } from './query-keys';

describe('mailQueryKeys', () => {
  it('isolates every mail resource by local account id', () => {
    expect(mailQueryKeys.mailboxes('account-a')).not.toEqual(mailQueryKeys.mailboxes('account-b'));
    expect(mailQueryKeys.threadPages('account-a')).not.toEqual(
      mailQueryKeys.threadPages('account-b'),
    );
  });

  it('normalizes equivalent thread-page filters to one cache key', () => {
    expect(
      mailQueryKeys.threadPage('account-a', {
        mailboxId: 'mailbox-inbox',
        text: '  quarterly report  ',
        snoozed: false,
      }),
    ).toEqual(
      mailQueryKeys.threadPage('account-a', {
        text: 'quarterly report',
        mailboxId: 'mailbox-inbox',
      }),
    );
  });

  it('keeps distinct mailbox and keyword filters in distinct cache keys', () => {
    expect(
      mailQueryKeys.threadPage('account-a', {
        mailboxId: 'mailbox-inbox',
        hasKeyword: '$seen',
      }),
    ).not.toEqual(
      mailQueryKeys.threadPage('account-a', {
        mailboxId: 'mailbox-archive',
        hasKeyword: '$seen',
      }),
    );
  });

  it('normalizes category filter arrays while keeping unread pages isolated', () => {
    expect(
      mailQueryKeys.threadPage('account-a', {
        hasMailboxIds: ['label-b', 'label-a', 'label-a'],
        hasKeywords: ['$flagged', '$important'],
        unreadOnly: true,
      }),
    ).toEqual(
      mailQueryKeys.threadPage('account-a', {
        hasKeywords: ['$important', '$flagged'],
        hasMailboxIds: ['label-a', 'label-b'],
        unreadOnly: true,
      }),
    );

    expect(mailQueryKeys.threadPage('account-a', { unreadOnly: true })).not.toEqual(
      mailQueryKeys.threadPage('account-a'),
    );
  });
});
