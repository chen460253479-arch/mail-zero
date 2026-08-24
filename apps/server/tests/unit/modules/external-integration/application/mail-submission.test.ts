import { describe, expect, it, vi } from 'vitest';

import {
  submitExternalMail,
  type ExternalMailSubmissionRecord,
  type ExternalMailSubmissionRepository,
  type ExternalMailSubmissionView,
} from '../../../../../src/modules/external-integration/application/mail-submission';
import {
  EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES,
  externalMailSubmissionInputSchema,
} from '../../../../../src/modules/external-integration/contracts/mail-submission';
import { ExternalIntegrationError } from '../../../../../src/modules/external-integration/errors';

const now = new Date('2026-08-05T08:00:00.000Z');
const input = externalMailSubmissionInputSchema.parse({
  externalUserId: 'crm_user_200',
  connectionId: 'connection_01',
  to: [{ email: 'customer@example.test', name: 'Customer' }],
  subject: 'Itinerary',
  htmlBody: '<p>Your itinerary</p>',
  attachments: [
    {
      filename: 'itinerary.pdf',
      contentType: 'application/pdf',
      url: 'https://assets.example.test/signed/itinerary.pdf',
      size: 1024,
    },
  ],
});

const view = (record: ExternalMailSubmissionRecord): ExternalMailSubmissionView => ({
  ...record,
  publicStatus: record.status === 'submitted' ? 'queued' : record.status,
  sentAt: null,
});

const createRepository = () => {
  let existing: ExternalMailSubmissionView | null = null;
  let createdRecord: ExternalMailSubmissionRecord | null = null;
  const repository = {
    findById: vi.fn(async () => existing),
    findByIdempotency: vi.fn(async () => existing),
    resolveScope: vi.fn(async () => ({
      userId: 'user-1',
      mailAccountId: 'account-1',
      internalConnectionId: 'internal-connection-1',
      identityId: 'identity-1',
    })),
    create: vi.fn(async ({ record }: { record: ExternalMailSubmissionRecord }) => {
      createdRecord = record;
      existing = view(record);
      return { outcome: 'created' as const, submission: existing };
    }),
    beginPreparation: vi.fn(),
    markDraftCreated: vi.fn(),
    markSubmitted: vi.fn(),
    recordProcessingFailure: vi.fn(),
  } as unknown as ExternalMailSubmissionRepository;
  return {
    repository,
    getCreated: () => createdRecord,
    setExisting: (submission: ExternalMailSubmissionView) => {
      existing = submission;
    },
  };
};

const dependencies = (repository: ExternalMailSubmissionRepository) => ({
  repository,
  nextId: () => 'external-submission-1',
  nextTaskId: () => 'task-1',
  clock: { now: () => now },
  notifyWorker: vi.fn(),
});

describe('submitExternalMail', () => {
  it('accepts a declared attachment total of 50 MiB', () => {
    expect(
      externalMailSubmissionInputSchema.safeParse({
        ...input,
        attachments: [
          {
            ...input.attachments[0],
            size: EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a declared attachment total above 50 MiB', () => {
    const result = externalMailSubmissionInputSchema.safeParse({
      ...input,
      attachments: [
        {
          ...input.attachments[0],
          size: EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES / 2,
        },
        {
          ...input.attachments[0],
          filename: 'itinerary-2.pdf',
          size: EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES / 2 + 1,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['attachments'],
          message: 'The declared attachment total exceeds 50 MiB',
        }),
      );
    }
  });

  it('persists a provider-neutral request and notifies the durable worker', async () => {
    const fake = createRepository();
    const deps = dependencies(fake.repository);

    const result = await submitExternalMail({ ...input, idempotencyKey: 'crm-send-1001' }, deps);

    expect(result).toMatchObject({
      created: true,
      response: {
        id: 'external-submission-1',
        externalUserId: 'crm_user_200',
        connectionId: 'connection_01',
        status: 'accepted',
      },
    });
    expect(fake.getCreated()).toMatchObject({
      mailAccountId: 'account-1',
      internalConnectionId: 'internal-connection-1',
      identityId: 'identity-1',
      payload: {
        to: input.to,
        subject: 'Itinerary',
        attachments: input.attachments,
      },
    });
    expect(deps.notifyWorker).toHaveBeenCalledOnce();
  });

  it('returns the original request for an identical idempotent retry', async () => {
    const fake = createRepository();
    const deps = dependencies(fake.repository);
    const first = await submitExternalMail({ ...input, idempotencyKey: 'crm-send-1001' }, deps);
    fake.setExisting({
      ...(fake.getCreated() as ExternalMailSubmissionRecord),
      publicStatus: 'queued',
      status: 'submitted',
      sentAt: null,
    });

    const retried = await submitExternalMail({ ...input, idempotencyKey: 'crm-send-1001' }, deps);

    expect(retried.created).toBe(false);
    expect(retried.response.id).toBe(first.response.id);
    expect(retried.response.status).toBe('queued');
    expect(deps.notifyWorker).toHaveBeenCalledOnce();
  });

  it('rejects reuse of an idempotency key with a different request', async () => {
    const fake = createRepository();
    const deps = dependencies(fake.repository);
    await submitExternalMail({ ...input, idempotencyKey: 'same-key' }, deps);

    await expect(
      submitExternalMail(
        { ...input, subject: 'Different subject', idempotencyKey: 'same-key' },
        deps,
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    } satisfies Partial<ExternalIntegrationError>);
  });
});
