import type { MailAccountRecord, MailCore, SubmissionRecord } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  openOwned: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('cloudflare:workers', () => {
  class RuntimeBase {}
  return {
    env: {},
    DurableObject: RuntimeBase,
    RpcTarget: RuntimeBase,
    WorkerEntrypoint: RuntimeBase,
    WorkflowEntrypoint: RuntimeBase,
  };
});

vi.mock('../../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openOwnedMailApiRuntime: runtimeMocks.openOwned,
}));

import { submissionRouter } from '../../../../../src/modules/mail-api/routers/submission';
import { router } from '../../../../../src/trpc/trpc';

describe('Submission Router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only the local submission projection', async () => {
    const account = {
      id: 'account-submission',
      userId: 'submission-user',
      status: 'active',
    } as MailAccountRecord;
    const submission = {
      id: 'submission-1',
      accountId: account.id,
      emailId: 'draft-1',
      identityId: 'identity-1',
      status: 'queued',
      sendAt: new Date('2026-01-01T00:00:00.000Z'),
      draftRevision: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      sentAt: null,
      providerMessageId: null,
      lastErrorMessage: null,
    } as SubmissionRecord;
    runtimeMocks.openOwned.mockResolvedValue({
      account,
      core: {
        getState: vi.fn(async () => '2'),
        getSubmission: vi.fn(async () => submission),
      } as unknown as MailCore,
      outbound: {},
      db: {},
      close: runtimeMocks.close,
    });
    const caller = router({ submission: submissionRouter }).createCaller({
      c: { env: {}, var: {} } as never,
      sessionUser: { id: account.userId } as never,
      auth: {} as never,
    });

    const result = await caller.submission.get({
      accountId: account.id,
      ids: [submission.id],
    });

    expect(result.list[0]).toMatchObject({ id: submission.id, status: 'queued' });
    expect(result.list[0]).not.toHaveProperty('providerMessageId');
    expect(runtimeMocks.close).toHaveBeenCalledOnce();
  });
});
