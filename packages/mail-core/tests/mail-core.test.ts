import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../src/testing/fakes';
import { createQueryHarness } from './helpers/query-harness';
import type { EmailId, ThreadId } from '../src';
import { createMailCore } from '../src';

describe('createMailCore', () => {
  it('binds the complete public command surface without exposing maintenance mutation', () => {
    const core = createMailCore(createMemoryMailCoreDependencies());

    expect(Object.keys(core).sort()).toEqual(
      [
        'cancelSubmission',
        'createAccount',
        'createDraft',
        'createIdentity',
        'createMailbox',
        'createSubmission',
        'destroyDraft',
        'destroyEmail',
        'destroyIdentity',
        'destroyMailbox',
        'getChanges',
        'getEmail',
        'getThread',
        'importEmail',
        'queryEmails',
        'queryThreads',
        'updateDraft',
        'updateEmail',
        'updateIdentity',
        'updateMailbox',
      ].sort(),
    );
    expect(core).not.toHaveProperty('garbageCollectBlobs');
  });

  it('serves account-scoped getEmail/getThread reads with stable not-found errors and no mutation', async () => {
    const h = await createQueryHarness();
    const core = createMailCore(h.dependencies);
    const before = await h.dependencies.inspect.stateVersion(h.accountId);

    await expect(
      core.getEmail({ accountId: h.accountId, emailId: h.email1 }),
    ).resolves.toMatchObject({ id: h.email1, accountId: h.accountId });
    await expect(
      core.getThread({ accountId: h.accountId, threadId: h.threadA }),
    ).resolves.toMatchObject({
      id: h.threadA,
      accountId: h.accountId,
      emailIds: [h.email1, h.email2, h.email3],
    });
    await expect(
      core.getEmail({ accountId: h.accountId, emailId: 'missing-email' as EmailId }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_FOUND' });
    await expect(
      core.getThread({ accountId: h.accountId, threadId: 'missing-thread' as ThreadId }),
    ).rejects.toMatchObject({ code: 'THREAD_NOT_FOUND' });
    expect(await h.dependencies.inspect.stateVersion(h.accountId)).toBe(before);
    expect(await h.dependencies.inspect.changes(h.accountId)).toEqual([]);
  });
});
