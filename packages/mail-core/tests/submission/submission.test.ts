import { describe, expect, it } from 'vitest';

import {
  cancelSubmission,
  createDraft,
  createSubmission,
  destroyDraft,
  destroyIdentity,
  garbageCollectBlobs,
  transitionSubmission,
  updateDraft,
} from '../../src';
import { createSubmissionHarness } from '../helpers/submission-harness';

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('EmailSubmission creation', () => {
  it('defensively rejects a persisted Draft with an injected recipient address', async () => {
    const h = await createSubmissionHarness();
    await h.mutate.email(h.draftId, {
      to: [{ email: 'victim@example.test\r\nBcc: attacker@example.test' }],
    });

    await expect(
      createSubmission(h.deps, {
        accountId: h.accountId,
        emailId: h.draftId,
        identityId: h.identityId,
        idempotencyKey: 'invalid-recipient-defense',
        sendAt: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    expect(await h.inspect.submissions()).toEqual([]);
  });

  it('creates immediate and future scheduled submissions with one Created Change each', async () => {
    const immediate = await createSubmissionHarness();
    const immediateVersion = await immediate.inspect.stateVersion();
    const immediateChanges = (await immediate.inspect.changes()).length;
    const queued = await createSubmission(immediate.deps, {
      accountId: immediate.accountId,
      emailId: immediate.draftId,
      identityId: immediate.identityId,
      idempotencyKey: 'immediate',
      sendAt: null,
    });

    expect(queued).toMatchObject({
      status: 'queued',
      draftRevision: 1,
    });
    expect(await immediate.inspect.stateVersion()).toBe(immediateVersion + 1n);
    expect((await immediate.inspect.changes()).slice(immediateChanges)).toEqual([
      expect.objectContaining({
        collection: 'email_submission',
        entityId: queued.id,
        changeType: 'created',
        changedProperties: null,
      }),
    ]);

    const scheduled = await createSubmissionHarness();
    const sendAt = new Date(scheduled.deps.clock.now().getTime() + 60_000);
    const result = await createSubmission(scheduled.deps, {
      accountId: scheduled.accountId,
      emailId: scheduled.draftId,
      identityId: scheduled.identityId,
      idempotencyKey: 'scheduled',
      sendAt,
    });
    expect(result.status).toBe('scheduled');
    expect(result.sendAt).toEqual(sendAt);
    sendAt.setUTCFullYear(2030);
    expect(result.sendAt.toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });

  it('serializes exact idempotent retries without allocating state or Change', async () => {
    const h = await createSubmissionHarness();
    const input = {
      accountId: h.accountId,
      emailId: h.draftId,
      identityId: h.identityId,
      idempotencyKey: 'same-key',
      sendAt: null,
    };
    const version = await h.inspect.stateVersion();
    const changes = (await h.inspect.changes()).length;
    const [first, second] = await Promise.all([
      createSubmission(h.deps, input),
      createSubmission(h.deps, input),
    ]);

    expect(second.id).toBe(first.id);
    expect(await h.inspect.submissions()).toHaveLength(1);
    expect(await h.inspect.stateVersion()).toBe(version + 1n);
    expect((await h.inspect.changes()).length).toBe(changes + 1);
  });

  it('rejects reusing an idempotency key with a different frozen request', async () => {
    const h = await createSubmissionHarness();
    const secondIdentity = await h.createIdentity('second');
    const input = {
      accountId: h.accountId,
      emailId: h.draftId,
      identityId: h.identityId,
      idempotencyKey: 'conflict-key',
      sendAt: null,
    };
    await createSubmission(h.deps, input);
    const version = await h.inspect.stateVersion();
    const changeCount = (await h.inspect.changes()).length;

    for (const conflict of [
      { ...input, emailId: h.otherDraftId },
      { ...input, identityId: secondIdentity.id },
      { ...input, sendAt: new Date('2026-01-02T00:00:00.000Z') },
    ]) {
      await expect(createSubmission(h.deps, conflict)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
      });
    }
    await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: h.draftId,
      expectedRevision: 1,
      content: { ...h.content, subject: 'Revised after submission' },
    });
    const afterDraftVersion = await h.inspect.stateVersion();
    const afterDraftChangeCount = (await h.inspect.changes()).length;
    await expect(createSubmission(h.deps, input)).resolves.toMatchObject({
      emailId: h.draftId,
      draftRevision: 1,
    });
    expect(await h.inspect.stateVersion()).toBe(afterDraftVersion);
    expect((await h.inspect.changes()).length).toBe(afterDraftChangeCount);
    expect(afterDraftVersion).toBeGreaterThan(version);
    expect(afterDraftChangeCount).toBeGreaterThan(changeCount);
  });

  it('freezes the Draft revision independently of later Draft updates', async () => {
    const h = await createSubmissionHarness();
    const submission = await createSubmission(h.deps, {
      accountId: h.accountId,
      emailId: h.draftId,
      identityId: h.identityId,
      idempotencyKey: 'frozen',
      sendAt: null,
    });
    await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: h.draftId,
      expectedRevision: 1,
      content: { ...h.content, subject: 'Later revision' },
    });
    expect(await h.inspect.submission(submission.id)).toMatchObject({
      emailId: h.draftId,
      draftRevision: 1,
    });
  });

  it('keeps the exact frozen Raw MIME snapshot after Draft replacement and GC', async () => {
    const h = await createSubmissionHarness();
    const attachment = await h.seedReadyBlob(
      new TextEncoder().encode('frozen attachment'),
      'text/plain',
    );
    const draft = await createDraft(h.deps, {
      ...h.content,
      subject: 'Frozen payload',
      attachmentBlobIds: [attachment.id],
    });
    const rawBefore = await h.inspect.rawBytes(draft.id);
    const submission = await createSubmission(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      identityId: h.identityId,
      idempotencyKey: 'frozen-payload',
      sendAt: null,
    });

    const rawRecordBefore = (await h.inspect.blob(draft.blobId!))!;
    expect(submission).toMatchObject({
      rawBlobId: draft.blobId,
      rawSha256: rawRecordBefore.sha256,
      rawSizeBytes: rawRecordBefore.sizeBytes,
      rawObjectKey: rawRecordBefore.objectKey,
    });

    await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: 1,
      content: { ...h.content, subject: 'Replacement payload' },
    });
    await destroyDraft(h.deps, { accountId: h.accountId, emailId: draft.id });
    h.deps.clock.set(new Date('2026-01-03T00:00:00.000Z'));
    await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 100,
    });

    const frozen = (await h.inspect.submission(submission.id))!;
    const rawRecord = await h.inspect.blob(frozen.rawBlobId);
    expect(rawRecord).not.toBeNull();
    await expect(
      h.deps.blobStore.get({
        accountId: h.accountId,
        objectKey: rawRecord!.objectKey,
      }),
    ).resolves.toEqual(rawBefore);
    expect(await h.inspect.blob(attachment.id)).toBeNull();
  });

  it('freezes one Raw MIME object containing every attachment occurrence', async () => {
    const h = await createSubmissionHarness();
    const attachment = await h.seedReadyBlob(
      new TextEncoder().encode('deduplicated attachment bytes'),
      'application/pdf',
    );
    const draft = await createDraft(h.deps, {
      ...h.content,
      subject: 'Shared body and attachment bytes',
      htmlBody: h.content.textBody,
      attachmentBlobIds: [attachment.id, attachment.id],
    });
    await h.deps.unitOfWork.run((tx) =>
      tx.blobs.update(h.accountId, attachment.id, {
        contentType: 'application/octet-stream',
      }),
    );

    const submission = await createSubmission(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      identityId: h.identityId,
      idempotencyKey: 'shared-part-content-type',
      sendAt: null,
    });

    expect(submission.rawBlobId).toBe(draft.blobId);
    const rawRecord = (await h.inspect.blob(submission.rawBlobId))!;
    const raw = decode(
      await h.deps.blobStore.get({
        accountId: h.accountId,
        objectKey: rawRecord.objectKey,
      }),
    );
    expect(raw.match(/Content-Type: application\/pdf/giu)).toHaveLength(2);
  });

  it('requires the exact Identity retained by the frozen Draft revision', async () => {
    const h = await createSubmissionHarness();
    const otherIdentity = await h.createIdentity('same-account-other');
    expect(await h.inspect.email(h.draftId)).toMatchObject({
      identityId: h.identityId,
    });

    await expect(
      createSubmission(h.deps, {
        accountId: h.accountId,
        emailId: h.draftId,
        identityId: otherIdentity.id,
        idempotencyKey: 'wrong-draft-identity',
        sendAt: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('classifies the schedule using time sampled after acquiring the account lock', async () => {
    const h = await createSubmissionHarness();
    const initialNow = h.deps.clock.now();
    const sendAt = new Date(initialNow.getTime() + 1_000);
    let releaseLock!: () => void;
    let lockAcquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = h.deps.unitOfWork.run(async () => {
      lockAcquired();
      await release;
    });
    await locked;
    const pending = createSubmission(h.deps, {
      accountId: h.accountId,
      emailId: h.draftId,
      identityId: h.identityId,
      idempotencyKey: 'lock-time-create',
      sendAt,
    });
    h.deps.clock.set(new Date(initialNow.getTime() + 2_000));
    releaseLock();
    await blocker;

    await expect(pending).resolves.toMatchObject({ status: 'queued' });
  });

  it('rejects cross-account Email and Identity references', async () => {
    const h = await createSubmissionHarness();
    const foreign = await h.createForeignAccount();
    const foreignDraft = await createDraft(h.deps, {
      ...h.content,
      accountId: foreign.account.id,
      identityId: foreign.identity.id,
    });
    const input = {
      accountId: h.accountId,
      emailId: h.draftId,
      identityId: h.identityId,
      idempotencyKey: 'cross-account',
      sendAt: null,
    };
    await expect(
      createSubmission(h.deps, { ...input, emailId: foreignDraft.id }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
    await expect(
      createSubmission(h.deps, {
        ...input,
        idempotencyKey: 'cross-identity',
        identityId: foreign.identity.id,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
  });

  it('rejects missing, destroyed, non-Draft, missing-Raw, pending-Raw, and recipient-less Emails', async () => {
    const cases: Array<
      (h: Awaited<ReturnType<typeof createSubmissionHarness>>) => Promise<unknown>
    > = [
      async (h) => {
        await destroyDraft(h.deps, {
          accountId: h.accountId,
          emailId: h.draftId,
        });
      },
      async (h) => h.mutate.email(h.draftId, { lifecycle: 'received' }),
      async (h) => h.mutate.email(h.draftId, { blobId: null }),
      async (h) => {
        const email = await h.inspect.email(h.draftId);
        await h.deps.unitOfWork.run((tx) =>
          tx.blobs.update(h.accountId, email!.blobId!, { status: 'pending' }),
        );
      },
      async (h) => h.mutate.email(h.draftId, { to: [], cc: [], bcc: [] }),
    ];

    for (const [index, arrange] of cases.entries()) {
      const h = await createSubmissionHarness();
      await arrange(h);
      const version = await h.inspect.stateVersion();
      const changes = (await h.inspect.changes()).length;
      await expect(
        createSubmission(h.deps, {
          accountId: h.accountId,
          emailId: h.draftId,
          identityId: h.identityId,
          idempotencyKey: `invalid-${index}`,
          sendAt: null,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(await h.inspect.stateVersion()).toBe(version);
      expect((await h.inspect.changes()).length).toBe(changes);
    }

    const h = await createSubmissionHarness();
    await expect(
      createSubmission(h.deps, {
        accountId: h.accountId,
        emailId: 'missing-email' as typeof h.draftId,
        identityId: h.identityId,
        idempotencyKey: 'missing',
        sendAt: null,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_FOUND' });
  });
});

describe('EmailSubmission business projection', () => {
  it.each([
    ['scheduled', 'queued'],
    ['scheduled', 'canceled'],
    ['queued', 'canceled'],
  ] as const)('allows %s -> %s and records one exact Updated Change', async (from, to) => {
    const h = await createSubmissionHarness({ initialStatus: from });
    if (from === 'scheduled') {
      h.deps.clock.set(new Date('2026-01-01T00:01:00.000Z'));
    }
    const version = await h.inspect.stateVersion();
    const changeCount = (await h.inspect.changes()).length;
    const result =
      to === 'canceled'
        ? await cancelSubmission(h.deps, {
            accountId: h.accountId,
            submissionId: h.submissionId!,
          })
        : await transitionSubmission(h.deps, {
            accountId: h.accountId,
            submissionId: h.submissionId!,
            to,
            outcome: null,
          });

    expect(result.status).toBe(to);
    expect(await h.inspect.stateVersion()).toBe(version + 1n);
    expect((await h.inspect.changes()).slice(changeCount)).toEqual([
      expect.objectContaining({
        collection: 'email_submission',
        entityId: h.submissionId,
        changeType: 'updated',
        changedProperties: ['status'],
      }),
    ]);
  });

  it('rejects releasing a scheduled submission before it is due', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'scheduled' });
    await expect(
      transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId: h.submissionId!,
        to: 'queued',
        outcome: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
  });

  it.each(['sent', 'failed', 'canceled'] as const)(
    'rejects transitions from terminal state %s',
    async (status) => {
      const h = await createSubmissionHarness({ initialStatus: status });
      await expect(
        transitionSubmission(h.deps, {
          accountId: h.accountId,
          submissionId: h.submissionId!,
          to: 'queued',
          outcome: null,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
    },
  );

  it('accepts only terminal provider projections from a queued Submission', async () => {
    const sentHarness = await createSubmissionHarness({ initialStatus: 'queued' });
    await expect(
      transitionSubmission(sentHarness.deps, {
        accountId: sentHarness.accountId,
        submissionId: sentHarness.submissionId!,
        to: 'sent',
        outcome: { type: 'sent', providerMessageId: 'provider-123' },
      }),
    ).resolves.toMatchObject({
      status: 'sent',
      providerMessageId: 'provider-123',
    });

    const failedHarness = await createSubmissionHarness({ initialStatus: 'queued' });
    await expect(
      transitionSubmission(failedHarness.deps, {
        accountId: failedHarness.accountId,
        submissionId: failedHarness.submissionId!,
        to: 'failed',
        outcome: {
          type: 'failure',
          retryable: false,
          providerCode: 'PERMANENT_FAILURE',
          safeResponse: 'policy_rejected',
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      lastErrorCode: 'PERMANENT_FAILURE',
      lastErrorMessage: 'policy_rejected',
    });
  });

  it('does not let Mail Core persist a retryable delivery failure', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'queued' });
    await expect(
      transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId: h.submissionId!,
        to: 'failed',
        outcome: { type: 'failure', retryable: true },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
  });

  it.each([
    'password=hunter2',
    'This is arbitrary body text.',
    'api_key=hunter2',
    'https://objects.test/private/signed-object',
    'MIME-Version: 1.0\r\n\r\nsecret body',
  ])('discards unsafe provider metadata: %s', async (safeResponse) => {
    const h = await createSubmissionHarness({ initialStatus: 'queued' });
    await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId: h.submissionId!,
      to: 'failed',
      outcome: {
        type: 'failure',
        retryable: false,
        providerCode: ' 550 invalid\r\nAuthorization: Bearer secret ',
        safeResponse,
      } as never,
    });
    const persisted = JSON.stringify(await h.inspect.submission(h.submissionId!), (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(persisted).not.toContain(safeResponse);
    expect(persisted).not.toMatch(/secret|hunter2|password|api_key|MIME-Version/i);
  });

  it('protects an Identity until all referencing Submissions are terminal', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'queued' });
    await expect(
      destroyIdentity(h.deps, {
        accountId: h.accountId,
        identityId: h.identityId,
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_IN_USE' });
    await cancelSubmission(h.deps, {
      accountId: h.accountId,
      submissionId: h.submissionId!,
    });
    await destroyIdentity(h.deps, {
      accountId: h.accountId,
      identityId: h.identityId,
    });
    expect(await h.deps.inspect.identity(h.identityId)).toBeNull();
  });
});
