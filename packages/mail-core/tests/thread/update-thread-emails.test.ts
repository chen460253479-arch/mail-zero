import { createMailCore, MailCoreError, type MailTransaction } from '../../src';
import { describe, expect, it } from 'vitest';

import { createSeededEmailHarness } from '../helpers/email-harness';

describe('updateThreadEmails', () => {
  it('updates every retained Email in a Thread inside one account transaction', async () => {
    const h = await createSeededEmailHarness({ keywords: ['$seen'] });
    const core = createMailCore(h.deps);

    const result = await core.updateThreadEmails({
      accountId: h.accountId,
      threadIds: [h.threadId, h.threadId],
      addMailboxIds: [],
      removeMailboxIds: [],
      addKeywords: ['$flagged'],
      removeKeywords: ['$seen'],
    });

    expect(result.failed).toEqual({});
    expect(result.updatedThreadIds).toEqual([h.threadId]);
    for (const emailId of [h.emailId]) {
      const email = await core.getEmail({ accountId: h.accountId, emailId });
      expect(email.keywords).toContain('$flagged');
      expect(email.keywords).not.toContain('$seen');
    }
  });

  it('reports a foreign Thread as one opaque item failure', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const result = await core.updateThreadEmails({
      accountId: h.accountId,
      threadIds: ['thread-foreign' as typeof h.threadId],
      addMailboxIds: [],
      removeMailboxIds: [],
      addKeywords: ['$seen'],
      removeKeywords: [],
    });
    expect(result.failed['thread-foreign']?.code).toBe('THREAD_NOT_FOUND');
  });

  it('aborts the whole transaction on an infrastructure failure', async () => {
    const h = await createSeededEmailHarness();
    const dependencies = {
      ...h.deps,
      unitOfWork: {
        run: <Result>(operation: (tx: MailTransaction) => Promise<Result>) =>
          h.deps.unitOfWork.run((tx) =>
            operation({
              ...tx,
              threads: {
                ...tx.threads,
                findById: async () => {
                  throw new MailCoreError('STORAGE_FAILURE');
                },
              },
            }),
          ),
      },
    };

    await expect(
      createMailCore(dependencies).updateThreadEmails({
        accountId: h.accountId,
        threadIds: [h.threadId],
        addMailboxIds: [],
        removeMailboxIds: [],
        addKeywords: ['$seen'],
        removeKeywords: [],
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
  });
});
