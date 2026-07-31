import { describe, expect, it } from 'vitest';

import {
  createDraft,
  createIdentity,
  createMailCore,
  type DraftContent,
  type EmailId,
} from '../../src';
import { createSeededEmailHarness } from '../helpers/email-harness';

const createHarness = async () => {
  const h = await createSeededEmailHarness();
  const identity = await createIdentity(h.deps, {
    accountId: h.accountId,
    name: 'Local sender',
    email: 'sender@example.test',
    replyTo: null,
    makeDefault: true,
  });
  const content: DraftContent = {
    identityId: identity.id,
    replyToEmailId: null,
    to: [{ email: 'recipient@example.test' }],
    cc: [],
    bcc: [],
    subject: 'Local draft',
    textBody: 'Draft body',
    htmlBody: '<p>Draft body</p>',
    attachments: [],
  };
  return { ...h, core: createMailCore(h.deps), content };
};

describe('setEmails', () => {
  it('moves a received Email to Trash as a membership update instead of destroying it', async () => {
    const h = await createHarness();
    const before = await h.inspect.stateVersion();

    const result = await h.core.setEmails({
      accountId: h.accountId,
      ifInState: before.toString(),
      create: {},
      update: {
        [h.emailId]: {
          mailboxIds: [h.trashId],
        },
      },
      destroy: [],
    });

    expect(result.oldState).toBe(before.toString());
    expect(result.newState).toBe((before + 1n).toString());
    expect(result.updated[h.emailId]).toMatchObject({
      mailboxIds: [h.trashId],
      restoreMailboxIds: [h.inboxId],
      destroyedAt: null,
    });
    await expect(
      h.core.getEmail({ accountId: h.accountId, emailId: h.emailId }),
    ).resolves.toMatchObject({ id: h.emailId, destroyedAt: null });
  });

  it('reports a stale Draft revision while committing a valid received Email update', async () => {
    const h = await createHarness();
    const draft = await createDraft(h.deps, {
      accountId: h.accountId,
      ...h.content,
    });
    const before = await h.inspect.stateVersion();

    const result = await h.core.setEmails({
      accountId: h.accountId,
      ifInState: before.toString(),
      create: {},
      update: {
        [draft.id]: {
          content: { ...h.content, subject: 'Stale edit' },
          ifDraftRevision: 0,
        },
        [h.emailId]: {
          keywords: ['$seen'],
        },
      },
      destroy: [],
    });

    expect(result.notUpdated[draft.id]).toMatchObject({
      code: 'DRAFT_REVISION_CONFLICT',
      details: { entityId: draft.id },
    });
    expect(result.updated[h.emailId]).toMatchObject({ keywords: ['$seen'] });
    expect(result.newState).toBe((before + 1n).toString());
    expect(await h.inspect.email(draft.id)).toMatchObject({
      draftRevision: 1,
      subject: h.content.subject,
    });
  });

  it('creates a Draft and permanently destroys another Email in one account state', async () => {
    const h = await createHarness();
    const before = await h.inspect.stateVersion();

    const result = await h.core.setEmails({
      accountId: h.accountId,
      ifInState: before.toString(),
      create: { localDraft: h.content },
      update: {},
      destroy: [h.emailId],
    });

    expect(result.created.localDraft).toMatchObject({
      lifecycle: 'draft',
      draftRevision: 1,
      subject: h.content.subject,
    });
    expect(result.destroyed).toEqual([h.emailId]);
    expect(result.newState).toBe((before + 1n).toString());
    expect(await h.inspect.email(h.emailId)).toMatchObject({
      destroyedAt: expect.any(Date),
      mailboxIds: [],
    });
    expect(await h.inspect.stateVersion()).toBe(before + 1n);
  });

  it('rejects a stale account state before applying any item', async () => {
    const h = await createHarness();
    const before = await h.inspect.stateVersion();

    await expect(
      h.core.setEmails({
        accountId: h.accountId,
        ifInState: (before - 1n).toString(),
        create: { localDraft: h.content },
        update: {
          [h.emailId]: { keywords: ['$seen'] },
        },
        destroy: [],
      }),
    ).rejects.toMatchObject({ code: 'STATE_MISMATCH' });

    expect(await h.inspect.stateVersion()).toBe(before);
    expect(await h.inspect.email(h.emailId)).toMatchObject({ keywords: [] });
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(new Map());
  });

  it('keeps received Email content immutable and rejects empty mailbox replacement per item', async () => {
    const h = await createHarness();
    const before = await h.inspect.stateVersion();
    const missingEmailId = 'missing-email' as EmailId;

    const result = await h.core.setEmails({
      accountId: h.accountId,
      create: {},
      update: {
        [h.emailId]: {
          content: h.content,
          ifDraftRevision: 1,
        },
        [missingEmailId]: {
          mailboxIds: [],
        },
      },
      destroy: [],
    });

    expect(result.notUpdated[h.emailId]?.code).toBe('EMAIL_CONTENT_IMMUTABLE');
    expect(result.notUpdated[missingEmailId]?.code).toBe('EMAIL_NOT_FOUND');
    expect(result.newState).toBe(before.toString());
  });

  it('validates and applies Draft content plus metadata as one item', async () => {
    const h = await createHarness();
    const draft = await createDraft(h.deps, {
      accountId: h.accountId,
      ...h.content,
    });
    const before = await h.inspect.stateVersion();

    const result = await h.core.setEmails({
      accountId: h.accountId,
      ifInState: before.toString(),
      create: {},
      update: {
        [draft.id]: {
          content: { ...h.content, subject: 'Combined update' },
          ifDraftRevision: 1,
          keywords: ['$draft', '$flagged'],
        },
      },
      destroy: [],
    });

    expect(result.updated[draft.id]).toMatchObject({
      subject: 'Combined update',
      draftRevision: 2,
      keywords: ['$draft', '$flagged'],
    });
    expect(result.newState).toBe((before + 1n).toString());
    expect(await h.inspect.stateVersion()).toBe(before + 1n);
    const emailChanges = (await h.inspect.changes()).filter(
      ({ stateVersion, collection, entityId }) =>
        stateVersion === before + 1n && collection === 'email' && entityId === draft.id,
    );
    expect(emailChanges).toHaveLength(1);
    expect(emailChanges[0]?.changedProperties).toEqual(
      expect.arrayContaining(['subject', 'keywords']),
    );
  });

  it('rolls back every database and Blob mutation after infrastructure failure', async () => {
    const h = await createHarness();
    const beforeState = await h.inspect.stateVersion();
    const beforeObjects = h.deps.blobStore.snapshot();
    const beforeChanges = await h.inspect.changes();
    // Each Draft now promotes exactly one Raw MIME object. Fail the second
    // promotion so the first committed object must also be compensated.
    h.deps.blobStore.failCommitAfterPromotions(2);

    await expect(
      h.core.setEmails({
        accountId: h.accountId,
        ifInState: beforeState.toString(),
        create: {
          first: h.content,
          second: {
            ...h.content,
            subject: 'Second draft',
            textBody: 'Different text',
            htmlBody: '<p>Different HTML</p>',
          },
        },
        update: {},
        destroy: [],
      }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE' });

    expect(await h.inspect.stateVersion()).toBe(beforeState);
    expect(await h.inspect.changes()).toEqual(beforeChanges);
    expect(h.deps.blobStore.snapshot()).toEqual(beforeObjects);
    expect(h.deps.blobStore.temporarySnapshot()).toEqual(new Map());
    expect(
      (await h.deps.inspect.emails(h.accountId)).filter(({ lifecycle }) => lifecycle === 'draft'),
    ).toEqual([]);
  });
});
