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

describe('EmailSubmission creation', () => {
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
      attemptCount: 0,
      nextAttemptAt: null,
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

  it('keeps the exact frozen Raw and attachment Blob snapshot after Draft replacement and GC', async () => {
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

    expect(submission.frozenBlobs).toEqual([
      expect.objectContaining({ kind: 'raw', position: 0, blobId: draft.blobId }),
      expect.objectContaining({ kind: 'text', position: 0, blobId: draft.textBlobId }),
      expect.objectContaining({ kind: 'html', position: 0, blobId: draft.htmlBlobId }),
      expect.objectContaining({ kind: 'part', position: 0, blobId: attachment.id }),
    ]);

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

    const frozen = (await h.inspect.submission(submission.id))!.frozenBlobs;
    const frozenRaw = frozen.find(({ kind }) => kind === 'raw')!;
    const rawRecord = await h.inspect.blob(frozenRaw.blobId);
    expect(rawRecord).not.toBeNull();
    await expect(
      h.deps.blobStore.get({
        accountId: h.accountId,
        objectKey: rawRecord!.objectKey,
      }),
    ).resolves.toEqual(rawBefore);
    expect(await h.inspect.blob(attachment.id)).not.toBeNull();
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

describe('EmailSubmission state machine', () => {
  it.each([
    ['scheduled', 'queued'],
    ['scheduled', 'canceled'],
    ['queued', 'sending'],
    ['queued', 'canceled'],
    ['retry_wait', 'queued'],
    ['retry_wait', 'canceled'],
  ] as const)('allows %s -> %s and records one exact Updated Change', async (from, to) => {
    const h = await createSubmissionHarness({ initialStatus: from });
    const submissionId = h.submissionId!;
    if (from === 'scheduled') {
      h.deps.clock.set(new Date('2026-01-01T00:01:00.000Z'));
    } else if (from === 'retry_wait' && to === 'queued') {
      const submission = await h.inspect.submission(submissionId);
      h.deps.clock.set(submission!.nextAttemptAt!);
    }
    const version = await h.inspect.stateVersion();
    const changes = (await h.inspect.changes()).length;
    const result =
      to === 'canceled'
        ? await cancelSubmission(h.deps, {
            accountId: h.accountId,
            submissionId,
          })
        : await transitionSubmission(h.deps, {
            accountId: h.accountId,
            submissionId,
            to,
            outcome: null,
          });

    expect(result.status).toBe(to);
    expect(await h.inspect.stateVersion()).toBe(version + 1n);
    expect((await h.inspect.changes()).slice(changes)).toEqual([
      expect.objectContaining({
        collection: 'email_submission',
        entityId: submissionId,
        changeType: 'updated',
        changedProperties:
          from === 'queued' && to === 'sending'
            ? ['status', 'attemptCount']
            : from === 'retry_wait' && to === 'queued'
              ? ['status', 'nextAttemptAt']
              : from === 'retry_wait' && to === 'canceled'
                ? ['status', 'nextAttemptAt']
                : ['status'],
      }),
    ]);
  });

  it.each(['sent', 'failed', 'canceled'] as const)(
    'rejects every transition from terminal state %s without a Change',
    async (status) => {
      const h = await createSubmissionHarness({ initialStatus: status });
      const version = await h.inspect.stateVersion();
      const changes = (await h.inspect.changes()).length;
      await expect(
        transitionSubmission(h.deps, {
          accountId: h.accountId,
          submissionId: h.submissionId!,
          to: 'queued',
          outcome: null,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
      expect(await h.inspect.stateVersion()).toBe(version);
      expect((await h.inspect.changes()).length).toBe(changes);
    },
  );

  it.each([
    ['scheduled', 'sending'],
    ['queued', 'sent'],
    ['retry_wait', 'sent'],
  ] as const)('rejects representative disallowed %s -> %s', async (from, to) => {
    const h = await createSubmissionHarness({ initialStatus: from });
    await expect(
      transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId: h.submissionId!,
        to,
        outcome: to === 'sent' ? { type: 'sent' } : null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
  });

  it('enforces scheduled and retry due times atomically', async () => {
    for (const status of ['scheduled', 'retry_wait'] as const) {
      const h = await createSubmissionHarness({ initialStatus: status });
      const version = await h.inspect.stateVersion();
      const changes = (await h.inspect.changes()).length;
      await expect(
        transitionSubmission(h.deps, {
          accountId: h.accountId,
          submissionId: h.submissionId!,
          to: 'queued',
          outcome: null,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
      expect(await h.inspect.stateVersion()).toBe(version);
      expect((await h.inspect.changes()).length).toBe(changes);
    }
  });

  it('evaluates due gates and Attempt timestamps after acquiring the account lock', async () => {
    const scheduled = await createSubmissionHarness({ initialStatus: 'scheduled' });
    const dueAt = (await scheduled.inspect.submission(scheduled.submissionId!))!.sendAt;
    let releaseLock!: () => void;
    let lockAcquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = scheduled.deps.unitOfWork.run(async () => {
      lockAcquired();
      await release;
    });
    await locked;
    const pending = transitionSubmission(scheduled.deps, {
      accountId: scheduled.accountId,
      submissionId: scheduled.submissionId!,
      to: 'queued',
      outcome: null,
    });
    scheduled.deps.clock.set(dueAt);
    releaseLock();
    await blocker;
    await expect(pending).resolves.toMatchObject({ status: 'queued' });

    const startedAt = new Date(dueAt.getTime() + 1_000);
    const secondBlockerLocked = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const secondRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const secondBlocker = scheduled.deps.unitOfWork.run(async () => {
      lockAcquired();
      await secondRelease;
    });
    await secondBlockerLocked;
    const sending = transitionSubmission(scheduled.deps, {
      accountId: scheduled.accountId,
      submissionId: scheduled.submissionId!,
      to: 'sending',
      outcome: null,
    });
    scheduled.deps.clock.set(startedAt);
    releaseLock();
    await secondBlocker;
    await sending;
    expect(await scheduled.inspect.attempts(scheduled.submissionId!)).toEqual([
      expect.objectContaining({ startedAt }),
    ]);
  });

  it.each(['sending', 'sent', 'failed', 'canceled'] as const)(
    'cancelSubmission rejects %s',
    async (status) => {
      const h = await createSubmissionHarness({ initialStatus: status });
      await expect(
        cancelSubmission(h.deps, {
          accountId: h.accountId,
          submissionId: h.submissionId!,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
    },
  );

  it.each([
    ['sent', { type: 'sent' } as const],
    ['retry_wait', { type: 'failure', retryable: true } as const],
    ['failed', { type: 'failure', retryable: false } as const],
  ] as const)('allows sending -> %s with a matching outcome', async (to, outcome) => {
    const h = await createSubmissionHarness({ initialStatus: 'sending' });
    const result = await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId: h.submissionId!,
      to,
      outcome,
    });
    expect(result.status).toBe(to);
    expect(await h.inspect.attempts(h.submissionId!)).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        outcome:
          to === 'sent' ? 'sent' : to === 'retry_wait' ? 'transient_failure' : 'permanent_failure',
      }),
    ]);
  });

  it.each([
    ['sent', null],
    ['sent', { type: 'failure', retryable: false }],
    ['retry_wait', { type: 'sent' }],
    ['retry_wait', { type: 'failure', retryable: false }],
    ['failed', { type: 'sent' }],
    ['failed', { type: 'failure', retryable: true }],
  ] as const)('rejects sending -> %s with a mismatched outcome', async (to, outcome) => {
    const h = await createSubmissionHarness({ initialStatus: 'sending' });
    await expect(
      transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId: h.submissionId!,
        to,
        outcome,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
    expect((await h.inspect.attempts(h.submissionId!))[0]).toMatchObject({
      finishedAt: null,
      outcome: null,
    });
  });

  it('rejects completion without exactly one open Attempt', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'sending' });
    const current = (await h.inspect.attempts(h.submissionId!))[0]!;
    await h.deps.unitOfWork.run((tx) =>
      tx.submissions.updateAttempt(h.accountId, h.submissionId!, current.attemptNumber, {
        finishedAt: h.deps.clock.now(),
        outcome: 'permanent_failure',
      }),
    );
    await expect(
      transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId: h.submissionId!,
        to: 'failed',
        outcome: { type: 'failure', retryable: false },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
  });
});

describe('EmailSubmission attempt history', () => {
  it('keeps completed attempts immutable across a retry and later success', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'sending' });
    const submissionId = h.submissionId!;
    const first = await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId,
      to: 'retry_wait',
      outcome: {
        type: 'failure',
        retryable: true,
        providerCode: 'RATE_LIMIT',
        safeResponse: 'rate_limited',
      },
    });
    const firstAttempt = (await h.inspect.attempts(submissionId))[0]!;
    expect(first.nextAttemptAt?.toISOString()).toBe('2026-01-01T00:00:30.000Z');
    h.deps.clock.set(first.nextAttemptAt!);
    await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId,
      to: 'queued',
      outcome: null,
    });
    await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId,
      to: 'sending',
      outcome: null,
    });
    h.deps.clock.set(new Date('2026-01-01T00:00:31.000Z'));
    const sent = await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId,
      to: 'sent',
      outcome: {
        type: 'sent',
        providerMessageId: 'provider-123',
        providerCode: '250',
        safeResponse: 'accepted',
      },
    });

    expect(sent).toMatchObject({
      status: 'sent',
      attemptCount: 2,
      providerMessageId: 'provider-123',
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: null,
    });
    expect(await h.inspect.attempts(submissionId)).toEqual([
      firstAttempt,
      expect.objectContaining({
        attemptNumber: 2,
        outcome: 'sent',
        providerCode: '250',
        safeResponse: 'accepted',
        retryAt: null,
      }),
    ]);
  });

  it('forces attempt six to permanent failure and never records retryAt', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'sending' });
    const submissionId = h.submissionId!;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const retry = await transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId,
        to: 'retry_wait',
        outcome: { type: 'failure', retryable: true },
      });
      h.deps.clock.set(retry.nextAttemptAt!);
      await transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId,
        to: 'queued',
        outcome: null,
      });
      await transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId,
        to: 'sending',
        outcome: null,
      });
    }
    await expect(
      transitionSubmission(h.deps, {
        accountId: h.accountId,
        submissionId,
        to: 'retry_wait',
        outcome: { type: 'failure', retryable: true },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
    const failed = await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId,
      to: 'failed',
      outcome: { type: 'failure', retryable: true },
    });
    expect(failed).toMatchObject({
      status: 'failed',
      attemptCount: 6,
      nextAttemptAt: null,
    });
    const attempts = await h.inspect.attempts(submissionId);
    expect(attempts).toHaveLength(6);
    expect(attempts[5]).toMatchObject({
      attemptNumber: 6,
      outcome: 'permanent_failure',
      retryAt: null,
    });
  });

  it.each([
    'password=hunter2',
    'This is arbitrary body text.',
    'api_key=hunter2',
    'https://objects.test/private/signed-object',
    'MIME-Version: 1.0\r\n\r\nsecret body',
  ])('discards unsafe or non-allowlisted response metadata: %s', async (safeResponse) => {
    const h = await createSubmissionHarness({ initialStatus: 'sending' });
    await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId: h.submissionId!,
      to: 'failed',
      outcome: {
        type: 'failure',
        retryable: false,
        providerCode: ' 550 invalid\r\nAuthorization: Bearer secret ',
        safeResponse,
        error: new Error('oauth access_token=secret'),
      } as never,
    });
    const persisted = JSON.stringify(
      {
        submission: await h.inspect.submission(h.submissionId!),
        attempts: await h.inspect.attempts(h.submissionId!),
      },
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
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
