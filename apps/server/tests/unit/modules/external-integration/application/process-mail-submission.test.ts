import { describe, expect, it, vi } from 'vitest';

import {
  processExternalMailSubmission,
  type ProcessExternalMailSubmissionDependencies,
} from '../../../../../src/modules/external-integration/application/process-mail-submission';
import type {
  ExternalMailSubmissionRecord,
  ExternalMailSubmissionRepository,
} from '../../../../../src/modules/external-integration/application/mail-submission';
import { MailTaskProcessingError } from '../../../../../src/modules/mail-tasks';

const now = new Date('2026-08-05T08:00:00.000Z');

const record = (emailId: string | null = null): ExternalMailSubmissionRecord => ({
  id: 'external-submission-1',
  userId: 'user-1',
  mailAccountId: 'account-1',
  internalConnectionId: 'internal-connection-1',
  identityId: 'identity-1',
  externalUserId: 'crm_user_200',
  externalConnectionId: 'connection_01',
  idempotencyKey: 'crm-send-1001',
  requestFingerprint: 'a'.repeat(64),
  payload: {
    replyToMessageId: null,
    to: [{ email: 'customer@example.test' }],
    cc: [],
    bcc: [],
    subject: 'Itinerary',
    textBody: '',
    htmlBody: '<p>Your itinerary</p>',
    attachments: [
      {
        filename: 'itinerary.pdf',
        contentType: 'application/pdf',
        url: 'https://assets.example.test/signed/itinerary.pdf',
        size: 3,
      },
    ],
    sendAt: null,
  },
  status: 'preparing',
  emailId,
  submissionId: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: now,
  updatedAt: now,
});

const createDependencies = (
  submission: ExternalMailSubmissionRecord,
): ProcessExternalMailSubmissionDependencies => {
  const repository = {
    beginPreparation: vi.fn(async () => submission),
    markDraftCreated: vi.fn(async () => undefined),
    markSubmitted: vi.fn(async () => undefined),
  } as unknown as ExternalMailSubmissionRepository;
  return {
    repository,
    core: {
      uploadBlob: vi.fn(async () => ({ blob: { id: 'blob-1' } })),
      createDraft: vi.fn(async () => ({ id: 'email-1' })),
    } as unknown as ProcessExternalMailSubmissionDependencies['core'],
    outbound: {
      submit: vi.fn(async () => ({ submission: { id: 'submission-1' } })),
    } as unknown as ProcessExternalMailSubmissionDependencies['outbound'],
    fetch: vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'content-length': '3' },
        }),
    ),
    clock: { now: () => now },
  };
};

describe('processExternalMailSubmission', () => {
  it('downloads URL attachments, creates a draft and submits through Zero outbound', async () => {
    const dependencies = createDependencies(record());

    await processExternalMailSubmission('external-submission-1', dependencies);

    expect(dependencies.fetch).toHaveBeenCalledWith(
      'https://assets.example.test/signed/itinerary.pdf',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
    expect(dependencies.core.uploadBlob).toHaveBeenCalledWith({
      accountId: 'account-1',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/pdf',
    });
    expect(dependencies.core.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        identityId: 'identity-1',
        attachments: [{ blobId: 'blob-1', filename: 'itinerary.pdf' }],
      }),
    );
    expect(dependencies.outbound.submit).toHaveBeenCalledWith({
      accountId: 'account-1',
      emailId: 'email-1',
      identityId: 'identity-1',
      idempotencyKey: 'external-mail:external-submission-1',
      sendAt: null,
    });
    expect(dependencies.repository.markSubmitted).toHaveBeenCalledWith(
      'external-submission-1',
      'email-1',
      'submission-1',
      now,
    );
  });

  it('reuses a previously persisted draft when a worker attempt is retried', async () => {
    const dependencies = createDependencies(record('existing-email'));

    await processExternalMailSubmission('external-submission-1', dependencies);

    expect(dependencies.fetch).not.toHaveBeenCalled();
    expect(dependencies.core.uploadBlob).not.toHaveBeenCalled();
    expect(dependencies.core.createDraft).not.toHaveBeenCalled();
    expect(dependencies.outbound.submit).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: 'existing-email' }),
    );
  });

  it('permanently rejects an attachment whose declared response exceeds 20 MiB', async () => {
    const dependencies = createDependencies(record());
    dependencies.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
        }),
    );

    await expect(
      processExternalMailSubmission('external-submission-1', dependencies),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_TOTAL_TOO_LARGE',
      disposition: 'permanent',
    } satisfies Partial<MailTaskProcessingError>);
    expect(dependencies.core.uploadBlob).not.toHaveBeenCalled();
  });
});
