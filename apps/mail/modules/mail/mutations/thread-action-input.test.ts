import { describe, expect, it } from 'vitest';

import {
  buildKeywordThreadAction,
  buildMoveThreadAction,
  buildRestoreArchivedThreadAction,
  buildSetThreadLabelsAction,
  resolveSystemMoveDestinationMailboxId,
} from './thread-action-input';
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

describe('thread action input', () => {
  it('omits a stale state precondition from an idempotent keyword command', () => {
    const commandWithStaleState = {
      accountId: 'account-1',
      threadIds: ['thread-1'],
      keyword: '$seen',
      enabled: true,
      ifInState: 'stale-state',
      clientMutationId: 'mutation-1',
    };

    expect(buildKeywordThreadAction(commandWithStaleState)).toEqual({
      accountId: 'account-1',
      threadIds: ['thread-1'],
      addMailboxIds: [],
      removeMailboxIds: [],
      addKeywords: ['$seen'],
      removeKeywords: [],
      clientMutationId: 'mutation-1',
    });
  });

  it('moves threads through the dedicated semantic destination input', () => {
    expect(
      buildMoveThreadAction({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        sourceMailboxId: 'mailbox-inbox',
        destinationMailboxId: 'mailbox-archive',
        ifInState: 'state-3',
        clientMutationId: 'mutation-2',
      }),
    ).toEqual({
      accountId: 'account-1',
      threadIds: ['thread-1'],
      ifInState: 'state-3',
      sourceMailboxId: 'mailbox-inbox',
      destinationMailboxId: 'mailbox-archive',
      clientMutationId: 'mutation-2',
    });
  });

  it('builds a lifecycle-aware archive restore command without a destination mailbox', () => {
    expect(
      buildRestoreArchivedThreadAction({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        ifInState: 'state-4',
        clientMutationId: 'mutation-restore',
      }),
    ).toEqual({
      accountId: 'account-1',
      threadIds: ['thread-1'],
      ifInState: 'state-4',
      clientMutationId: 'mutation-restore',
    });
  });

  it('resolves legacy system actions to one local destination mailbox', () => {
    const mailboxes = [
      systemMailbox('mailbox-inbox', 'inbox'),
      systemMailbox('mailbox-archive', 'archive'),
    ];
    expect(resolveSystemMoveDestinationMailboxId('archive', mailboxes)).toBe('mailbox-archive');
    expect(() => resolveSystemMoveDestinationMailboxId('spam', mailboxes)).toThrow(
      'MAILBOX_ROLE_NOT_FOUND:junk',
    );
  });

  it('submits only label mailboxes through updateThreads', () => {
    const mailboxes = [
      systemMailbox('mailbox-inbox', 'inbox'),
      {
        ...systemMailbox('label-customer', 'inbox'),
        kind: 'label' as const,
        role: null,
      },
      {
        ...systemMailbox('folder-projects', 'inbox'),
        kind: 'folder' as const,
        role: null,
      },
    ];

    expect(
      buildSetThreadLabelsAction({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        addLabelIds: ['label-customer', 'label-customer'],
        removeLabelIds: [],
        mailboxes,
        clientMutationId: 'mutation-3',
      }),
    ).toEqual({
      accountId: 'account-1',
      threadIds: ['thread-1'],
      addMailboxIds: ['label-customer'],
      removeMailboxIds: [],
      addKeywords: [],
      removeKeywords: [],
      clientMutationId: 'mutation-3',
    });
    expect(() =>
      buildSetThreadLabelsAction({
        accountId: 'account-1',
        threadIds: ['thread-1'],
        addLabelIds: ['folder-projects'],
        removeLabelIds: [],
        mailboxes,
        clientMutationId: 'mutation-4',
      }),
    ).toThrow('MAILBOX_LABEL_NOT_FOUND:folder-projects');
  });
});
