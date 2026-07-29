import { describe, expect, it } from 'vitest';

import { createSubmission, finalizeSubmissionSent, importEmail, updateEmail } from '../../src';
import { createSeededImportDependencies } from '../helpers/import-harness';
import { createSubmissionHarness } from '../helpers/submission-harness';

describe('transactional email notifications', () => {
  it('records one received notification when a new inbound email commits', async () => {
    const { core, input } = await createSeededImportDependencies();

    const result = await importEmail(core, input);

    expect(result.created).toBe(true);
    await expect(core.inspect.notifications()).resolves.toEqual([
      expect.objectContaining({
        messageId: result.emailId,
        accountId: input.accountId,
        kind: 'received',
      }),
    ]);
  });

  it('does not enqueue another notification for a duplicate remote email', async () => {
    const { core, input } = await createSeededImportDependencies();

    await importEmail(core, input);
    const duplicate = await importEmail(core, input);

    expect(duplicate.created).toBe(false);
    await expect(core.inspect.notifications()).resolves.toHaveLength(1);
  });

  it('records one sent notification in the successful finalization transaction', async () => {
    const harness = await createSubmissionHarness();
    const submission = await createSubmission(harness.deps, {
      accountId: harness.accountId,
      emailId: harness.draftId,
      identityId: harness.identityId,
      idempotencyKey: 'notification-finalization',
      sendAt: null,
    });

    await finalizeSubmissionSent(harness.deps, {
      accountId: harness.accountId,
      submissionId: submission.id,
      provider: 'gmail',
      remoteMessageId: 'gmail-notification-1',
      remoteThreadId: null,
      acceptedAt: new Date('2026-01-01T00:00:30.000Z'),
    });

    await expect(harness.deps.inspect.notifications()).resolves.toEqual([
      expect.objectContaining({
        messageId: harness.draftId,
        accountId: harness.accountId,
        kind: 'sent',
      }),
    ]);
  });

  it('does not notify for an ordinary email state update', async () => {
    const harness = await createSubmissionHarness();

    await updateEmail(harness.deps, {
      accountId: harness.accountId,
      emailId: harness.draftId,
      addKeywords: ['$seen'],
    });

    await expect(harness.deps.inspect.notifications()).resolves.toEqual([]);
  });
});
