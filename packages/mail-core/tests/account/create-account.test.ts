import { describe, expect, it } from 'vitest';

import { createIdentity, createMailAccount, destroyIdentity, updateIdentity } from '../../src';
import type { EmailId, EmailSubmissionId, SubmissionStatus } from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

describe('MailAccount commands', () => {
  it('creates all required system Mailboxes atomically', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'Asia/Shanghai',
      storageQuotaBytes: null,
    });

    const roles = (await deps.inspect.mailboxes(account.id)).map(({ role }) => role).sort();
    expect(roles).toEqual(
      ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'outbox', 'scheduled'].sort(),
    );
    expect(await deps.inspect.changes(account.id)).toHaveLength(8);
    expect(await deps.inspect.stateVersion(account.id)).toBe(1n);

    const identity = await createIdentity(deps, {
      accountId: account.id,
      name: 'Zero User',
      email: 'user@example.test',
      replyTo: null,
      makeDefault: true,
    });
    expect(identity).toMatchObject({
      email: 'user@example.test',
      isDefault: true,
    });
  });

  it('keeps exactly one default Identity per account', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const first = await createIdentity(deps, {
      accountId: account.id,
      name: 'First',
      email: 'first@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const second = await createIdentity(deps, {
      accountId: account.id,
      name: 'Second',
      email: 'second@example.test',
      replyTo: null,
      makeDefault: true,
    });

    expect(await deps.inspect.identity(first.id)).toMatchObject({
      isDefault: false,
    });
    expect(await deps.inspect.identity(second.id)).toMatchObject({
      isDefault: true,
    });
    const identityChanges = (await deps.inspect.changes(account.id)).filter(
      ({ collection }) => collection === 'identity',
    );
    expect(identityChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: first.id,
          changeType: 'updated',
          stateVersion: 3n,
        }),
        expect.objectContaining({
          entityId: second.id,
          changeType: 'created',
          stateVersion: 3n,
        }),
      ]),
    );
  });

  it('normalizes and validates Identity email addresses on create and update', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const identity = await createIdentity(deps, {
      accountId: account.id,
      name: 'Zero User',
      email: ' USER@Example.TEST ',
      replyTo: ' REPLY@Example.TEST ',
      makeDefault: false,
    });

    expect(identity).toMatchObject({
      email: 'user@example.test',
      replyTo: 'reply@example.test',
      isDefault: true,
    });
    await expect(
      createIdentity(deps, {
        accountId: account.id,
        name: 'Invalid',
        email: 'user..name@example.test',
        replyTo: null,
        makeDefault: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    await expect(
      updateIdentity(deps, {
        accountId: account.id,
        identityId: identity.id,
        email: 'not-an-email',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    expect(await deps.inspect.stateVersion(account.id)).toBe(2n);

    const updated = await updateIdentity(deps, {
      accountId: account.id,
      identityId: identity.id,
      email: ' SECOND@Example.TEST ',
      replyTo: null,
    });
    expect(updated).toMatchObject({
      email: 'second@example.test',
      replyTo: null,
    });
  });

  it('rejects malformed Identity addresses while retaining common plus tags', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });

    await expect(
      createIdentity(deps, {
        accountId: account.id,
        name: 'Malformed primary',
        email: 'foo<bar@example.com',
        replyTo: null,
        makeDefault: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    await expect(
      createIdentity(deps, {
        accountId: account.id,
        name: 'Malformed reply-to',
        email: 'valid@example.test',
        replyTo: 'user@bad_domain.example',
        makeDefault: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EMAIL' });

    await expect(
      createIdentity(deps, {
        accountId: account.id,
        name: 'Plus tag',
        email: ' USER+Receipts@Example.TEST ',
        replyTo: ' REPLY+LIST@Example.TEST ',
        makeDefault: false,
      }),
    ).resolves.toMatchObject({
      email: 'user+receipts@example.test',
      replyTo: 'reply+list@example.test',
    });
  });

  it('sets a new default atomically and does not allocate state for a no-op', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const first = await createIdentity(deps, {
      accountId: account.id,
      name: 'First',
      email: 'first@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const second = await createIdentity(deps, {
      accountId: account.id,
      name: 'Second',
      email: 'second@example.test',
      replyTo: null,
      makeDefault: false,
    });

    const updated = await updateIdentity(deps, {
      accountId: account.id,
      identityId: second.id,
      makeDefault: true,
    });
    expect(updated.isDefault).toBe(true);
    expect(await deps.inspect.identity(first.id)).toMatchObject({
      isDefault: false,
    });
    const versionAfterChange = await deps.inspect.stateVersion(account.id);
    expect(versionAfterChange).toBe(4n);

    await updateIdentity(deps, {
      accountId: account.id,
      identityId: second.id,
      makeDefault: true,
    });
    expect(await deps.inspect.stateVersion(account.id)).toBe(versionAfterChange);
  });

  it.each<SubmissionStatus>(['scheduled', 'queued'])(
    'rejects destroying an Identity used by a %s Submission',
    async (status) => {
      const deps = createMemoryMailCoreDependencies();
      const account = await createMailAccount(deps, {
        userId: 'user-1',
        connectionId: `connection-${status}`,
        timezone: 'UTC',
        storageQuotaBytes: null,
      });
      const identity = await createIdentity(deps, {
        accountId: account.id,
        name: 'Sender',
        email: 'sender@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const now = deps.clock.now();
      await deps.unitOfWork.run((tx) =>
        tx.submissions.insert({
          id: `submission-${status}` as EmailSubmissionId,
          accountId: account.id,
          emailId: `email-${status}` as EmailId,
          identityId: identity.id,
          status,
          sendAt: now,
          idempotencyKey: `key-${status}`,
          draftRevision: 1,
          frozenBlobs: [],
          providerMessageId: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          createdAt: now,
          updatedAt: now,
          sentAt: null,
        }),
      );

      await expect(
        destroyIdentity(deps, {
          accountId: account.id,
          identityId: identity.id,
        }),
      ).rejects.toMatchObject({ code: 'IDENTITY_IN_USE' });
      expect(await deps.inspect.identity(identity.id)).not.toBeNull();
      expect(await deps.inspect.stateVersion(account.id)).toBe(2n);
    },
  );

  it('destroys an Identity referenced only by terminal Submissions', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const identity = await createIdentity(deps, {
      accountId: account.id,
      name: 'Sender',
      email: 'sender@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const now = deps.clock.now();
    await deps.unitOfWork.run((tx) =>
      tx.submissions.insert({
        id: 'submission-sent' as EmailSubmissionId,
        accountId: account.id,
        emailId: 'email-sent' as EmailId,
        identityId: identity.id,
        status: 'sent',
        sendAt: now,
        idempotencyKey: 'key-sent',
        draftRevision: 1,
        frozenBlobs: [],
        providerMessageId: 'provider-message',
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
        sentAt: now,
      }),
    );

    await destroyIdentity(deps, {
      accountId: account.id,
      identityId: identity.id,
    });

    expect(await deps.inspect.identity(identity.id)).toBeNull();
    expect(await deps.inspect.stateVersion(account.id)).toBe(3n);
  });

  it('promotes a replacement when destroying the default Identity', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const first = await createIdentity(deps, {
      accountId: account.id,
      name: 'First',
      email: 'first@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const second = await createIdentity(deps, {
      accountId: account.id,
      name: 'Second',
      email: 'second@example.test',
      replyTo: null,
      makeDefault: false,
    });

    await destroyIdentity(deps, {
      accountId: account.id,
      identityId: first.id,
    });

    expect(await deps.inspect.identity(first.id)).toBeNull();
    expect(await deps.inspect.identity(second.id)).toMatchObject({
      isDefault: true,
    });
    const finalChanges = (await deps.inspect.changes(account.id)).filter(
      ({ stateVersion }) => stateVersion === 4n,
    );
    expect(finalChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: first.id,
          changeType: 'destroyed',
        }),
        expect.objectContaining({
          entityId: second.id,
          changeType: 'updated',
          changedProperties: ['isDefault'],
        }),
      ]),
    );
  });
});
