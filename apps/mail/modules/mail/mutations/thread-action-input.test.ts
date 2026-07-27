import { describe, expect, it } from 'vitest';

import { buildKeywordThreadAction, buildMoveThreadAction } from './thread-action-input';
import type { Mailbox } from '../model/mailbox';

const systemMailbox = (id: string, role: NonNullable<Mailbox['role']>): Mailbox => ({
  id,
  parentId: null,
  name: role,
  kind: 'system',
  role,
  color: null,
  sortOrder: 0,
  isSubscribed: true,
  totalEmails: 0,
  unreadEmails: 0,
  totalThreads: 0,
  unreadThreads: 0,
});

const mailboxes = [
  systemMailbox('mailbox-inbox', 'inbox'),
  systemMailbox('mailbox-archive', 'archive'),
  systemMailbox('mailbox-trash', 'trash'),
  systemMailbox('mailbox-junk', 'junk'),
];

describe('thread action input', () => {
  it('maps read state to the local $seen keyword with a state precondition', () => {
    expect(
      buildKeywordThreadAction({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        keyword: '$seen',
        enabled: true,
        ifInState: 'state-3',
        clientMutationId: 'mutation-1',
      }),
    ).toEqual({
      accountId: 'account-1',
      threadIds: ['thread-1'],
      ifInState: 'state-3',
      addMailboxIds: [],
      removeMailboxIds: [],
      addKeywords: ['$seen'],
      removeKeywords: [],
      clientMutationId: 'mutation-1',
    });
  });

  it('moves Inbox threads into the local Archive mailbox', () => {
    expect(
      buildMoveThreadAction({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        destination: 'archive',
        mailboxes,
        ifInState: 'state-3',
        clientMutationId: 'mutation-2',
      }),
    ).toEqual({
      accountId: 'account-1',
      threadIds: ['thread-1'],
      ifInState: 'state-3',
      addMailboxIds: ['mailbox-archive'],
      removeMailboxIds: ['mailbox-inbox', 'mailbox-trash', 'mailbox-junk'],
      addKeywords: [],
      removeKeywords: [],
      clientMutationId: 'mutation-2',
    });
  });

  it('fails locally when the destination system mailbox is unavailable', () => {
    expect(() =>
      buildMoveThreadAction({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        destination: 'archive',
        mailboxes: [],
        clientMutationId: 'mutation-3',
      }),
    ).toThrow('MAILBOX_ROLE_NOT_FOUND:archive');
  });
});
