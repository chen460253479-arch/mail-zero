import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { EmailId, MailAccountId, ThreadId } from '../../src';

const now = new Date('2026-01-01T00:00:00.000Z');

describe('memory ThreadReference repository', () => {
  it('isolates candidates by account and subject, deduplicates, moves, and deletes references', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const accountA = 'account-a' as MailAccountId;
    const accountB = 'account-b' as MailAccountId;
    const record = (
      accountId: MailAccountId,
      normalizedSubjectHash: string,
      messageIdHash: string,
      emailId: string,
      threadId: string,
    ) => ({
      accountId,
      normalizedSubjectHash,
      messageIdHash,
      emailId: emailId as EmailId,
      threadId: threadId as ThreadId,
      createdAt: now,
    });
    const a1 = record(accountA, 'subject-a', 'message-1', 'email-1', 'thread-1');
    const a2 = record(accountA, 'subject-a', 'message-2', 'email-2', 'thread-2');
    const otherSubject = record(accountA, 'subject-b', 'message-1', 'email-3', 'thread-3');
    const otherAccount = record(accountB, 'subject-a', 'message-1', 'email-4', 'thread-4');

    await dependencies.unitOfWork.run(async (tx) => {
      for (const reference of [a1, a1, a2, otherSubject, otherAccount]) {
        await tx.threadReferences.insert(reference);
      }
    });

    const candidates = await dependencies.unitOfWork.run((tx) =>
      tx.threadReferences.findCandidates({
        accountId: accountA,
        normalizedSubjectHash: 'subject-a',
        messageIdHashes: ['message-2', 'message-1', 'message-1'],
      }),
    );
    expect(candidates).toEqual([a1, a2]);

    await dependencies.unitOfWork.run((tx) =>
      tx.threadReferences.moveThread(accountA, 'thread-1' as ThreadId, 'thread-2' as ThreadId),
    );
    await expect(
      dependencies.unitOfWork.run((tx) =>
        tx.threadReferences.findCandidates({
          accountId: accountA,
          normalizedSubjectHash: 'subject-a',
          messageIdHashes: ['message-1'],
        }),
      ),
    ).resolves.toEqual([{ ...a1, threadId: 'thread-2' }]);

    await dependencies.unitOfWork.run((tx) =>
      tx.threadReferences.deleteByEmail(accountA, 'email-2' as EmailId),
    );
    await expect(
      dependencies.unitOfWork.run((tx) =>
        tx.threadReferences.findCandidates({
          accountId: accountA,
          normalizedSubjectHash: 'subject-a',
          messageIdHashes: ['message-1', 'message-2'],
        }),
      ),
    ).resolves.toEqual([{ ...a1, threadId: 'thread-2' }]);
    await expect(
      dependencies.unitOfWork.run((tx) =>
        tx.threadReferences.findCandidates({
          accountId: accountB,
          normalizedSubjectHash: 'subject-a',
          messageIdHashes: ['message-1'],
        }),
      ),
    ).resolves.toEqual([otherAccount]);
  });
});
