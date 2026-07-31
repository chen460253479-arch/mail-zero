import type {
  BlobId,
  EmailId,
  EmailPartRecord,
  EmailRecord,
  EmailSubmissionId,
  IdentityId,
  MailAccountId,
  MailboxId,
  SubmissionRecord,
  ThreadId,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

const record = (
  accountId: MailAccountId,
  threadId: ThreadId,
  mailboxId: MailboxId,
  id: EmailId,
  overrides: Partial<EmailRecord> = {},
): EmailRecord => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    accountId,
    identityId: null,
    threadId,
    blobId: null,
    messageId: null,
    replyToEmailId: null,
    inReplyTo: [],
    references: [],
    subject: 'constraint probe',
    preview: '',
    sentAt: null,
    receivedAt: now,
    sizeBytes: 1n,
    hasAttachment: false,
    lifecycle: 'received',
    draftRevision: 0,
    createdAt: now,
    updatedAt: now,
    destroyedAt: null,
    sender: [],
    from: [],
    replyTo: [],
    to: [],
    cc: [],
    bcc: [],
    textBody: '',
    htmlBody: '',
    parserVersion: 1,
    parseWarnings: [],
    parts: [],
    mailboxIds: [mailboxId],
    restoreMailboxIds: [],
    keywords: [],
    ...overrides,
  };
};

describe('PostgreSQL account-scoped constraints', () => {
  it('normalizes every cross-account aggregate relationship without leaking driver details', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const primary = await createPostgresMailTestHarness(db, unitOfWork, 'constraint-primary');
      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'constraint-foreign');
      const now = primary.dependencies.clock.now();
      const primaryThread = 'constraint-primary-thread' as ThreadId;
      const foreignThread = 'constraint-foreign-thread' as ThreadId;
      const primaryBlob = 'constraint-primary-blob' as BlobId;
      const foreignBlob = 'constraint-foreign-blob' as BlobId;
      const primaryIdentity = 'constraint-primary-identity' as IdentityId;
      const foreignIdentity = 'constraint-foreign-identity' as IdentityId;
      const primaryEmail = 'constraint-primary-email' as EmailId;
      const foreignEmail = 'constraint-foreign-email' as EmailId;
      const foreignPart = 'constraint-foreign-part';
      const foreignSubmission = 'constraint-foreign-submission' as EmailSubmissionId;

      await unitOfWork.run(async (tx) => {
        for (const [accountId, id] of [
          [primary.accountId, primaryThread],
          [foreign.accountId, foreignThread],
        ] as const) {
          await tx.threads.insert({
            id,
            accountId,
            normalizedSubject: 'constraint',
            latestReceivedAt: now,
            emailCount: 1,
            unreadCount: 1,
            hasAttachment: false,
            participantSummary: null,
            preview: null,
            createdAt: now,
            updatedAt: now,
          });
        }
        for (const [accountId, id] of [
          [primary.accountId, primaryBlob],
          [foreign.accountId, foreignBlob],
        ] as const) {
          await tx.blobs.insert({
            id,
            accountId,
            sha256: `sha-${id}`,
            sizeBytes: 1n,
            contentType: 'application/octet-stream',
            objectKey: `constraint/${id}`,
            status: 'ready',
            createdAt: now,
            readyAt: now,
            deletedAt: null,
          });
        }
        for (const [accountId, id] of [
          [primary.accountId, primaryIdentity],
          [foreign.accountId, foreignIdentity],
        ] as const) {
          await tx.identities.insert({
            id,
            accountId,
            name: null,
            email: `${id}@example.test`,
            replyTo: null,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          });
        }
        await tx.emails.insert(
          record(primary.accountId, primaryThread, primary.inbox.id, primaryEmail),
        );
        await tx.emails.insert(
          record(foreign.accountId, foreignThread, foreign.inbox.id, foreignEmail, {
            parts: [
              {
                id: foreignPart,
                parentPartId: null,
                partPath: '1',
                contentType: 'application/octet-stream',
                charset: null,
                disposition: 'attachment',
                filename: null,
                contentId: null,
                rawBlobId: foreignBlob,
                offsetStart: 0n,
                encodedLength: 1n,
                decodedLength: 1n,
                transferEncoding: 'binary',
                sizeBytes: 1n,
                kind: 'attachment',
              },
            ],
          }),
        );
        await tx.submissions.insert({
          id: foreignSubmission,
          accountId: foreign.accountId,
          emailId: foreignEmail,
          identityId: foreignIdentity,
          status: 'queued',
          sendAt: now,
          idempotencyKey: 'constraint-foreign-submission',
          draftRevision: 0,
          rawBlobId: foreignBlob,
          rawSha256: `sha-${foreignBlob}`,
          rawSizeBytes: 1n,
          rawObjectKey: `constraint/${foreignBlob}`,
          providerMessageId: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          createdAt: now,
          updatedAt: now,
          sentAt: null,
        });
      });

      let nextEmail = 1;
      const probe = (overrides: Partial<EmailRecord>) =>
        unitOfWork.run((tx) =>
          tx.emails.insert(
            record(
              primary.accountId,
              primaryThread,
              primary.inbox.id,
              `constraint-probe-${nextEmail++}` as EmailId,
              overrides,
            ),
          ),
        );
      const part = (overrides: Partial<EmailPartRecord>): EmailPartRecord => ({
        id: `constraint-probe-part-${nextEmail}`,
        parentPartId: null,
        partPath: '1',
        contentType: 'application/octet-stream',
        charset: null,
        disposition: 'attachment',
        filename: null,
        contentId: null,
        rawBlobId: primaryBlob,
        offsetStart: 0n,
        encodedLength: 1n,
        decodedLength: 1n,
        transferEncoding: 'binary',
        sizeBytes: 1n,
        kind: 'attachment',
        ...overrides,
      });
      const submission = (overrides: Partial<SubmissionRecord>): SubmissionRecord => ({
        id: `constraint-primary-submission-${nextEmail++}` as EmailSubmissionId,
        accountId: primary.accountId,
        emailId: primaryEmail,
        identityId: primaryIdentity,
        status: 'queued',
        sendAt: now,
        idempotencyKey: `constraint-primary-${nextEmail}`,
        draftRevision: 0,
        rawBlobId: primaryBlob,
        rawSha256: `sha-${primaryBlob}`,
        rawSizeBytes: 1n,
        rawObjectKey: `constraint/${primaryBlob}`,
        providerMessageId: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
        sentAt: null,
        ...overrides,
      });
      const expectCrossAccount = async (operation: Promise<unknown>) => {
        await expect(operation).rejects.toMatchObject({
          code: 'CROSS_ACCOUNT_REFERENCE',
          details: {},
        });
      };

      await expectCrossAccount(probe({ threadId: foreignThread }));
      await expectCrossAccount(probe({ blobId: foreignBlob }));
      await expectCrossAccount(probe({ identityId: foreignIdentity }));
      await expectCrossAccount(probe({ replyToEmailId: foreignEmail }));
      await expectCrossAccount(probe({ mailboxIds: [foreign.inbox.id] }));
      await expectCrossAccount(probe({ restoreMailboxIds: [foreign.inbox.id] }));
      await expectCrossAccount(probe({ parts: [part({ rawBlobId: foreignBlob })] }));
      await expectCrossAccount(
        probe({ parts: [part({ parentPartId: foreignPart, rawBlobId: primaryBlob })] }),
      );
      await expectCrossAccount(
        unitOfWork.run((tx) => tx.submissions.insert(submission({ emailId: foreignEmail }))),
      );
      await expectCrossAccount(
        unitOfWork.run((tx) => tx.submissions.insert(submission({ identityId: foreignIdentity }))),
      );
      await expectCrossAccount(
        unitOfWork.run((tx) =>
          tx.submissions.insert(
            submission({
              rawBlobId: foreignBlob,
              rawSha256: `sha-${foreignBlob}`,
              rawObjectKey: `constraint/${foreignBlob}`,
            }),
          ),
        ),
      );
      await expectCrossAccount(
        unitOfWork.run((tx) =>
          tx.emails.publishSearchDocument(primary.accountId, foreignEmail, {
            subject: 'foreign',
            addressText: '',
            bodyText: '',
          }),
        ),
      );
      await unitOfWork.run((tx) =>
        tx.emails.update(primary.accountId, primaryEmail, {
          identityId: primaryIdentity,
        }),
      );
      await unitOfWork.run((tx) => tx.identities.delete(primary.accountId, primaryIdentity));
      await unitOfWork.run(async (tx) => {
        expect(await tx.identities.findById(primary.accountId, primaryIdentity)).toBeNull();
        expect(await tx.emails.findById(primary.accountId, primaryEmail)).toMatchObject({
          identityId: primaryIdentity,
        });
      });
    }));
});
