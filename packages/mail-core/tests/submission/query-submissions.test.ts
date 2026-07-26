import { describe, expect, it } from 'vitest';

import type {
  EmailId,
  EmailSubmissionId,
  IdentityId,
  MailAccountId,
  SubmissionRecord,
  SubmissionStatus,
} from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import { createMailCore } from '../../src';

const accountOne = 'account-1' as MailAccountId;
const accountTwo = 'account-2' as MailAccountId;

const submission = (
  id: string,
  accountId: MailAccountId,
  status: SubmissionStatus,
  createdAt: Date,
): SubmissionRecord => ({
  id: id as EmailSubmissionId,
  accountId,
  emailId: `email-${id}` as EmailId,
  identityId: `identity-${accountId}` as IdentityId,
  status,
  sendAt: createdAt,
  idempotencyKey: `key-${accountId}-${id}`,
  draftRevision: 1,
  frozenBlobs: [],
  providerMessageId: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt,
  updatedAt: createdAt,
  sentAt: null,
});

const createHarness = async () => {
  const dependencies = createMemoryMailCoreDependencies();
  await dependencies.unitOfWork.run(async (tx) => {
    await tx.accounts.insert({
      id: accountOne,
      userId: 'user-1',
      connectionId: 'connection-1',
    });
    await tx.accounts.insert({
      id: accountTwo,
      userId: 'user-2',
      connectionId: 'connection-2',
    });
  });
  return { dependencies, core: createMailCore(dependencies) };
};

describe('EmailSubmission reads', () => {
  it('gets one account-scoped submission and returns stable not-found errors', async () => {
    const h = await createHarness();
    const record = submission(
      'submission-1',
      accountOne,
      'queued',
      new Date('2026-01-01T00:00:00Z'),
    );
    await h.dependencies.unitOfWork.run((tx) => tx.submissions.insert(record));

    await expect(
      h.core.getSubmission({ accountId: accountOne, submissionId: record.id }),
    ).resolves.toEqual(record);
    await expect(
      h.core.getSubmission({
        accountId: accountOne,
        submissionId: 'missing-submission' as EmailSubmissionId,
      }),
    ).rejects.toMatchObject({
      code: 'EMAIL_SUBMISSION_NOT_FOUND',
      details: { entityId: 'missing-submission' },
    });
    await expect(
      h.core.getSubmission({ accountId: accountTwo, submissionId: record.id }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
  });

  it('returns only submissions from the requested account and status', async () => {
    const h = await createHarness();
    const queued = submission(
      'submission-queued',
      accountOne,
      'queued',
      new Date('2026-01-01T00:00:00Z'),
    );
    const sent = submission(
      'submission-sent',
      accountOne,
      'sent',
      new Date('2026-01-01T00:01:00Z'),
    );
    const foreign = submission(
      'submission-foreign',
      accountTwo,
      'queued',
      new Date('2026-01-01T00:02:00Z'),
    );
    await h.dependencies.unitOfWork.run(async (tx) => {
      await tx.submissions.insert(queued);
      await tx.submissions.insert(sent);
      await tx.submissions.insert(foreign);
    });

    await expect(
      h.core.querySubmissions({
        accountId: accountOne,
        status: 'queued',
        limit: 20,
        cursor: null,
      }),
    ).resolves.toEqual({
      submissions: [queued],
      nextCursor: null,
    });
  });

  it('paginates deterministically by createdAt then id without gaps', async () => {
    const h = await createHarness();
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const records = [
      submission('submission-b', accountOne, 'queued', createdAt),
      submission('submission-a', accountOne, 'queued', createdAt),
      submission('submission-c', accountOne, 'queued', new Date('2026-01-01T00:01:00Z')),
    ];
    await h.dependencies.unitOfWork.run(async (tx) => {
      for (const record of records) {
        await tx.submissions.insert(record);
      }
    });

    const first = await h.core.querySubmissions({
      accountId: accountOne,
      status: 'queued',
      limit: 1,
      cursor: null,
    });
    expect(first.submissions.map(({ id }) => id)).toEqual(['submission-a']);
    expect(first.nextCursor).not.toBeNull();

    const second = await h.core.querySubmissions({
      accountId: accountOne,
      status: 'queued',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.submissions.map(({ id }) => id)).toEqual(['submission-b']);
    expect(second.nextCursor).not.toBeNull();

    const third = await h.core.querySubmissions({
      accountId: accountOne,
      status: 'queued',
      limit: 1,
      cursor: second.nextCursor,
    });
    expect(third.submissions.map(({ id }) => id)).toEqual(['submission-c']);
    expect(third.nextCursor).toBeNull();
  });

  it('pushes the cursor and limit plus one into the repository read', async () => {
    const h = await createHarness();
    const createdAt = new Date('2026-01-01T00:00:00Z');
    await h.dependencies.unitOfWork.run(async (tx) => {
      await tx.submissions.insert(submission('submission-a', accountOne, 'queued', createdAt));
      await tx.submissions.insert(submission('submission-b', accountOne, 'queued', createdAt));
    });

    const first = await h.core.querySubmissions({
      accountId: accountOne,
      status: 'queued',
      limit: 1,
      cursor: null,
    });
    expect(h.dependencies.inspect.submissionQueries()).toEqual([
      {
        accountId: accountOne,
        status: 'queued',
        after: null,
        limit: 2,
      },
    ]);

    await h.core.querySubmissions({
      accountId: accountOne,
      status: 'queued',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(h.dependencies.inspect.submissionQueries().at(-1)).toEqual({
      accountId: accountOne,
      status: 'queued',
      after: {
        createdAt,
        submissionId: 'submission-a',
      },
      limit: 2,
    });
  });

  it('binds cursors to the account and status filter', async () => {
    const h = await createHarness();
    const createdAt = new Date('2026-01-01T00:00:00Z');
    await h.dependencies.unitOfWork.run(async (tx) => {
      await tx.submissions.insert(submission('submission-a', accountOne, 'queued', createdAt));
      await tx.submissions.insert(submission('submission-b', accountOne, 'queued', createdAt));
    });
    const first = await h.core.querySubmissions({
      accountId: accountOne,
      status: 'queued',
      limit: 1,
      cursor: null,
    });

    await expect(
      h.core.querySubmissions({
        accountId: accountTwo,
        status: 'queued',
        limit: 1,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
    await expect(
      h.core.querySubmissions({
        accountId: accountOne,
        status: 'sent',
        limit: 1,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it.each([0, -1, 1.5, 201])('rejects an invalid page limit %s', async (limit) => {
    const h = await createHarness();

    await expect(
      h.core.querySubmissions({
        accountId: accountOne,
        limit,
        cursor: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('rejects malformed cursors and validates the account before listing', async () => {
    const h = await createHarness();

    await expect(
      h.core.querySubmissions({
        accountId: accountOne,
        limit: 20,
        cursor: 'not-a-valid-cursor',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      h.core.querySubmissions({
        accountId: 'missing-account' as MailAccountId,
        limit: 20,
        cursor: null,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
});
