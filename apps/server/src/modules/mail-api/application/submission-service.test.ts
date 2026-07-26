import type { MailCore, SubmissionRecord } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';

import { createSubmissionService } from './submission-service';

const submission: SubmissionRecord = {
  id: 'submission-1' as SubmissionRecord['id'],
  accountId: 'account-1' as SubmissionRecord['accountId'],
  emailId: 'draft-1' as SubmissionRecord['emailId'],
  identityId: 'identity-1' as SubmissionRecord['identityId'],
  status: 'queued',
  sendAt: new Date('2026-01-01T00:00:00.000Z'),
  idempotencyKey: 'request-1',
  draftRevision: 3,
  frozenBlobs: [],
  providerMessageId: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  sentAt: null,
};

describe('Submission service', () => {
  it('accepts a submission through the outbound Spool without claiming provider success', async () => {
    const set = vi.fn(async () => ({
      oldState: '8',
      newState: '9',
      created: { clientRequest: submission },
      destroyed: [],
      notCreated: {},
      notDestroyed: {},
    }));
    const service = createSubmissionService({} as unknown as MailCore, { set } as never);

    const result = await service.set({
      accountId: submission.accountId,
      create: {
        clientRequest: {
          emailId: submission.emailId,
          identityId: submission.identityId,
          idempotencyKey: submission.idempotencyKey,
          sendAt: null,
        },
      },
      destroy: [],
    });

    expect(set).toHaveBeenCalledWith({
      accountId: submission.accountId,
      ifInState: undefined,
      create: {
        clientRequest: {
          emailId: submission.emailId,
          identityId: submission.identityId,
          idempotencyKey: submission.idempotencyKey,
          sendAt: null,
        },
      },
      destroy: [],
    });
    expect(result.created.clientRequest?.status).toBe('queued');
    expect(result.created.clientRequest?.status).not.toBe('sent');
  });

  it('reads the local queued state until the worker finalizes delivery', async () => {
    const getSubmission = vi.fn(async () => submission);
    const service = createSubmissionService(
      {
        getState: vi.fn(async () => '8'),
        getSubmission,
      } as unknown as MailCore,
      { set: vi.fn() } as never,
    );

    const result = await service.get({
      accountId: submission.accountId,
      ids: [submission.id],
    });

    expect(result.list[0]?.status).toBe('queued');
    expect(result.list[0]).not.toHaveProperty('providerMessageId');
    expect(result.list[0]).not.toHaveProperty('lastErrorMessage');
  });
});
