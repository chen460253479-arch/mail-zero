import { createDraft, createIdentity, createSubmission, updateDraft } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

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
      const initialTextBlob = await unitOfWork.run((tx) =>
        tx.blobs.findById(harness.accountId, draft.textBlobId!),
      );
      expect(initialTextBlob).not.toBeNull();
      const initialTextBytes = await harness.blobStore.get(initialTextBlob!.objectKey);
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
        expect(updatedDraft!.textBlobId).not.toBe(draft.textBlobId);
        expect(await tx.blobs.findById(harness.accountId, draft.textBlobId!)).toEqual(
          initialTextBlob,
        );
        expect(
          await tx.blobs.findById(harness.accountId, updatedDraft!.textBlobId!),
        ).not.toBeNull();
        expect(await tx.submissions.findById(harness.accountId, submission.id)).toMatchObject({
          draftRevision: 1,
        });
      });
      expect(await harness.blobStore.get(initialTextBlob!.objectKey)).toEqual(initialTextBytes);
    }));
});
