import {
  createDraft,
  createIdentity,
  createSubmission,
  setEmails,
  updateDraft,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('PostgreSQL Draft integration', () => {
  it('serializes an expected revision and freezes the Submission revision', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork);
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Draft Sender',
        email: 'draft-sender@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const content = {
        accountId: harness.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ name: 'Recipient', email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Draft subject',
        textBody: 'Draft revision one body.',
        htmlBody: '',
        attachmentBlobIds: [],
      };
      const draft = await createDraft(harness.dependencies, content);
      const initialRawBlob = await unitOfWork.run((tx) =>
        tx.blobs.findById(harness.accountId, draft.blobId!),
      );
      expect(initialRawBlob).not.toBeNull();
      const initialRawBytes = await harness.blobStore.get({
        accountId: harness.accountId,
        objectKey: initialRawBlob!.objectKey,
      });
      const submission = await createSubmission(harness.dependencies, {
        accountId: harness.accountId,
        emailId: draft.id,
        identityId: identity.id,
        idempotencyKey: 'draft-submit-1',
        sendAt: null,
      });

      const updates = await Promise.allSettled([
        updateDraft(harness.dependencies, {
          accountId: harness.accountId,
          emailId: draft.id,
          expectedRevision: 1,
          content: { ...content, subject: 'Winner A' },
        }),
        updateDraft(harness.dependencies, {
          accountId: harness.accountId,
          emailId: draft.id,
          expectedRevision: 1,
          content: { ...content, subject: 'Winner B' },
        }),
      ]);

      expect(
        updates.map((result) =>
          result.status === 'fulfilled'
            ? { status: result.status }
            : {
                status: result.status,
                code:
                  typeof result.reason === 'object' &&
                  result.reason !== null &&
                  'code' in result.reason
                    ? result.reason.code
                    : 'unknown',
              },
        ),
      ).toEqual(
        expect.arrayContaining([
          { status: 'fulfilled' },
          { status: 'rejected', code: 'DRAFT_REVISION_CONFLICT' },
        ]),
      );
      const rejection = updates.find(({ status }) => status === 'rejected');
      expect(rejection).toMatchObject({
        reason: { code: 'DRAFT_REVISION_CONFLICT', details: { entityId: draft.id } },
      });
      await unitOfWork.run(async (tx) => {
        const updatedDraft = await tx.emails.findById(harness.accountId, draft.id);
        expect(updatedDraft).toMatchObject({
          identityId: identity.id,
          draftRevision: 2,
        });
        expect(updatedDraft!.blobId).not.toBe(draft.blobId);
        expect(await tx.blobs.findById(harness.accountId, draft.blobId!)).toEqual(initialRawBlob);
        expect(await tx.blobs.findById(harness.accountId, updatedDraft!.blobId!)).not.toBeNull();
        expect(await tx.submissions.findById(harness.accountId, submission.id)).toMatchObject({
          draftRevision: 1,
          rawBlobId: draft.blobId,
          rawSha256: initialRawBlob!.sha256,
          rawSizeBytes: initialRawBlob!.sizeBytes,
          rawObjectKey: initialRawBlob!.objectKey,
        });
      });
      expect(
        await harness.blobStore.get({
          accountId: harness.accountId,
          objectKey: initialRawBlob!.objectKey,
        }),
      ).toEqual(initialRawBytes);
    }));

  it('commits Email/set create, update, and destroy with one PostgreSQL state', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'email-set');
      const identity = await createIdentity(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Batch sender',
        email: 'batch-sender@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const content = {
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Batch draft',
        textBody: 'Batch body',
        htmlBody: '',
        attachmentBlobIds: [],
      };
      const updatedDraft = await createDraft(harness.dependencies, {
        accountId: harness.accountId,
        ...content,
      });
      const destroyedDraft = await createDraft(harness.dependencies, {
        accountId: harness.accountId,
        ...content,
        subject: 'Destroy me',
      });
      const before = await unitOfWork.run(async (tx) => {
        const account = await tx.accounts.findById(harness.accountId);
        return account!.stateVersion;
      });

      const result = await setEmails(harness.dependencies, {
        accountId: harness.accountId,
        ifInState: before.toString(),
        create: {
          created: { ...content, subject: 'Created in set' },
        },
        update: {
          [updatedDraft.id]: {
            content: { ...content, subject: 'Updated in set' },
            ifDraftRevision: 1,
            keywords: ['$draft', '$flagged'],
          },
        },
        destroy: [destroyedDraft.id],
      });

      expect(result).toMatchObject({
        oldState: before.toString(),
        newState: (before + 1n).toString(),
        destroyed: [destroyedDraft.id],
        notCreated: {},
        notUpdated: {},
        notDestroyed: {},
      });
      expect(result.created.created).toMatchObject({
        subject: 'Created in set',
        draftRevision: 1,
      });
      expect(result.updated[updatedDraft.id]).toMatchObject({
        subject: 'Updated in set',
        draftRevision: 2,
        keywords: ['$draft', '$flagged'],
      });
      await unitOfWork.run(async (tx) => {
        expect(await tx.emails.findById(harness.accountId, destroyedDraft.id)).toMatchObject({
          destroyedAt: expect.any(Date),
          mailboxIds: [],
        });
        expect((await tx.accounts.findById(harness.accountId))!.stateVersion).toBe(before + 1n);
      });
    }));
});
