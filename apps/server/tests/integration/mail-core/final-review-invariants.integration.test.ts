import {
  createDraft,
  createIdentity,
  createMailAccount,
  createMailbox,
  createSubmission,
  destroyDraft,
  garbageCollectBlobs,
  importEmail,
  uploadBlob,
  updateDraft,
  updateEmail,
  updateIdentity,
  updateMailbox,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import {
  blob,
  email,
  emailAddress,
  emailContent,
  emailKeyword,
  emailMailbox,
  emailPart,
  emailSearch,
  emailSubmission,
  mailChange,
  mailIdentity,
} from '../../../src/modules/mail/postgres/schema';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';
import { connection, user } from '../../../src/db/schema';

const startTogether = async <Result>(
  operations: [() => Promise<Result>, () => Promise<Result>],
): Promise<PromiseSettledResult<Result>[]> => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready = 0;
  let bothReady!: () => void;
  const readyGate = new Promise<void>((resolve) => {
    bothReady = resolve;
  });
  const wrap = (operation: () => Promise<Result>) => async () => {
    ready += 1;
    if (ready === 2) bothReady();
    await gate;
    return operation();
  };
  const pending = Promise.allSettled(operations.map((operation) => wrap(operation)()));
  await readyGate;
  release();
  return pending;
};

describe('final review PostgreSQL invariants', () => {
  it('freezes one Raw MIME Submission payload through Draft destruction and GC', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'frozen-payload');
      const identity = await createIdentity(h.dependencies, {
        accountId: h.accountId,
        name: 'Frozen Sender',
        email: 'frozen-sender@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const attachment = await uploadBlob(h.dependencies, {
        accountId: h.accountId,
        bytes: new TextEncoder().encode('attachment bytes'),
        contentType: 'application/octet-stream',
      });
      const draft = await createDraft(h.dependencies, {
        accountId: h.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Frozen payload',
        textBody: 'original payload',
        htmlBody: '<p>original payload</p>',
        attachments: [{ blobId: attachment.blob.id, filename: 'attachment.bin' }],
      });
      const rawRecord = await unitOfWork.run((tx) => tx.blobs.findById(h.accountId, draft.blobId!));
      const rawBefore = await h.blobStore.get({
        accountId: h.accountId,
        objectKey: rawRecord!.objectKey,
      });
      const submission = await createSubmission(h.dependencies, {
        accountId: h.accountId,
        emailId: draft.id,
        identityId: identity.id,
        idempotencyKey: 'frozen-payload',
        sendAt: null,
      });

      const submissionRawRecord = await unitOfWork.run((tx) =>
        tx.blobs.findById(h.accountId, submission.rawBlobId),
      );
      expect(submission).toMatchObject({
        rawBlobId: submissionRawRecord!.id,
        rawSha256: rawRecord!.sha256,
        rawSizeBytes: rawRecord!.sizeBytes,
        rawObjectKey: submissionRawRecord!.objectKey,
      });
      expect(submissionRawRecord).toMatchObject({
        kind: 'draft_mime',
        sha256: rawRecord!.sha256,
        sizeBytes: rawRecord!.sizeBytes,
      });
      expect(submissionRawRecord!.id).toBe(draft.blobId);
      await updateDraft(h.dependencies, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: {
          identityId: identity.id,
          replyToEmailId: null,
          to: [{ email: 'recipient@example.test' }],
          cc: [],
          bcc: [],
          subject: 'Replacement payload',
          textBody: 'replacement',
          htmlBody: '',
          attachments: [],
        },
      });
      await destroyDraft(h.dependencies, { accountId: h.accountId, emailId: draft.id });
      await garbageCollectBlobs(h.dependencies, {
        accountId: h.accountId,
        olderThan: new Date('2026-01-02T00:00:00.000Z'),
        limit: 100,
      });

      const loaded = await unitOfWork.run((tx) =>
        tx.submissions.findById(h.accountId, submission.id),
      );
      const preserved = await unitOfWork.run((tx) =>
        tx.blobs.findById(h.accountId, loaded!.rawBlobId),
      );
      expect(preserved).not.toBeNull();
      expect(preserved!.id).toBe(draft.blobId);
      await expect(
        unitOfWork.run((tx) => tx.blobs.findById(h.accountId, draft.blobId!)),
      ).resolves.toEqual(preserved);
      await expect(
        h.blobStore.get({
          accountId: h.accountId,
          objectKey: preserved!.objectKey,
        }),
      ).resolves.toEqual(rawBefore);

      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'frozen-foreign');
      const foreignIdentity = await createIdentity(foreign.dependencies, {
        accountId: foreign.accountId,
        name: 'Foreign',
        email: 'foreign-frozen@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const foreignDraft = await createDraft(foreign.dependencies, {
        accountId: foreign.accountId,
        identityId: foreignIdentity.id,
        replyToEmailId: null,
        to: [{ email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Foreign',
        textBody: 'foreign blob',
        htmlBody: '',
        attachments: [],
      });
      const foreignRawRecord = await unitOfWork.run((tx) =>
        tx.blobs.findById(foreign.accountId, foreignDraft.blobId!),
      );
      await expect(
        db
          .update(emailSubmission)
          .set({
            rawBlobId: foreignDraft.blobId!,
            rawSha256: foreignRawRecord!.sha256,
            rawSizeBytes: foreignRawRecord!.sizeBytes,
            rawObjectKey: foreignRawRecord!.objectKey,
          })
          .where(eq(emailSubmission.id, submission.id)),
      ).rejects.toBeInstanceOf(Error);
    }));

  it('serializes default Identity updates and mutual Mailbox parent changes', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'account-locks');
      const defaults = await startTogether([
        () =>
          createIdentity(h.dependencies, {
            accountId: h.accountId,
            name: 'First',
            email: 'first-lock@example.test',
            replyTo: null,
            makeDefault: true,
          }),
        () =>
          createIdentity(h.dependencies, {
            accountId: h.accountId,
            name: 'Second',
            email: 'second-lock@example.test',
            replyTo: null,
            makeDefault: true,
          }),
      ]);
      expect(defaults.every(({ status }) => status === 'fulfilled')).toBe(true);
      const activeDefaults = await db
        .select()
        .from(mailIdentity)
        .where(and(eq(mailIdentity.mailAccountId, h.accountId), eq(mailIdentity.isDefault, true)));
      expect(activeDefaults).toHaveLength(1);

      const identity = defaults[0].status === 'fulfilled' ? defaults[0].value : null;
      const firstIdentity = await unitOfWork.run((tx) =>
        tx.identities.findById(h.accountId, identity!.id),
      );
      expect(identity).toBeDefined();
      await startTogether([
        () =>
          updateIdentity(h.dependencies, {
            accountId: h.accountId,
            identityId: firstIdentity!.id,
            name: 'Updated name',
          }),
        () =>
          updateIdentity(h.dependencies, {
            accountId: h.accountId,
            identityId: firstIdentity!.id,
            email: 'updated-lock@example.test',
          }),
      ]);
      await expect(
        unitOfWork.run((tx) => tx.identities.findById(h.accountId, firstIdentity!.id)),
      ).resolves.toMatchObject({
        name: 'Updated name',
        email: 'updated-lock@example.test',
      });

      const first = await createMailbox(h.dependencies, {
        accountId: h.accountId,
        name: 'First parent',
        kind: 'folder',
        role: null,
        parentId: null,
      });
      const second = await createMailbox(h.dependencies, {
        accountId: h.accountId,
        name: 'Second parent',
        kind: 'folder',
        role: null,
        parentId: null,
      });
      const cycles = await startTogether([
        () =>
          updateMailbox(h.dependencies, {
            accountId: h.accountId,
            mailboxId: first.id,
            parentId: second.id,
          }),
        () =>
          updateMailbox(h.dependencies, {
            accountId: h.accountId,
            mailboxId: second.id,
            parentId: first.id,
          }),
      ]);
      expect(cycles.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(cycles.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: { code: 'MAILBOX_PARENT_CYCLE' },
      });
    }));

  it('rejects cross-user Connection ownership with a stable safe error', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'owner-primary');
      const now = h.dependencies.clock.now();
      await db.insert(user).values({
        id: 'owner-other-user',
        name: 'Other owner',
        email: 'owner-other@example.test',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values({
        id: 'owner-primary-unbound',
        userId: 'postgres-user-owner-primary',
        email: 'owner-primary-unbound@example.test',
        normalizedEmail: 'owner-primary-unbound@example.test',
        channelId: 'gmail',
        providerKey: 'test.postgres',
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values({
        id: 'owner-other-connection',
        userId: 'owner-other-user',
        email: 'owner-other@example.test',
        normalizedEmail: 'owner-other@example.test',
        channelId: 'gmail',
        providerKey: 'test.postgres',
        createdAt: now,
        updatedAt: now,
      });
      await expect(
        createMailAccount(h.dependencies, {
          userId: 'owner-other-user',
          connectionId: 'owner-primary-unbound',
          timezone: 'UTC',
          storageQuotaBytes: null,
        }),
      ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE', details: {} });
    }));

  it('physically removes sensitive Email projections and rolls back invalid Draft patches', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'destroy-projection');
      const identity = await createIdentity(h.dependencies, {
        accountId: h.accountId,
        name: 'Sensitive Sender',
        email: 'sensitive@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const draft = await createDraft(h.dependencies, {
        accountId: h.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'secret-recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Sensitive subject',
        textBody: 'sensitive body',
        htmlBody: '',
        attachments: [],
      });
      const beforeAccount = await unitOfWork.run((tx) => tx.accounts.findById(h.accountId));
      const beforeChanges = await db
        .select()
        .from(mailChange)
        .where(eq(mailChange.mailAccountId, h.accountId));
      await expect(
        updateEmail(h.dependencies, {
          accountId: h.accountId,
          emailId: draft.id,
          removeKeywords: ['$draft'],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_PATCH' });
      expect(await unitOfWork.run((tx) => tx.accounts.findById(h.accountId))).toEqual(
        beforeAccount,
      );
      expect(
        await db.select().from(mailChange).where(eq(mailChange.mailAccountId, h.accountId)),
      ).toEqual(beforeChanges);

      await db
        .update(email)
        .set({
          messageIdHeader: '<sensitive-message@example.test>',
          inReplyTo: ['sensitive-parent@example.test'],
          references: ['sensitive-root@example.test', 'sensitive-parent@example.test'],
        })
        .where(and(eq(email.mailAccountId, h.accountId), eq(email.id, draft.id)));
      await destroyDraft(h.dependencies, { accountId: h.accountId, emailId: draft.id });
      expect(await db.select().from(emailSearch).where(eq(emailSearch.emailId, draft.id))).toEqual(
        [],
      );
      expect(
        await db.select().from(emailAddress).where(eq(emailAddress.emailId, draft.id)),
      ).toEqual([]);
      expect(await db.select().from(emailPart).where(eq(emailPart.emailId, draft.id))).toEqual([]);
      expect(
        await db.select().from(emailMailbox).where(eq(emailMailbox.emailId, draft.id)),
      ).toEqual([]);
      expect(
        await db.select().from(emailKeyword).where(eq(emailKeyword.emailId, draft.id)),
      ).toEqual([]);
      expect(
        await db.select().from(emailContent).where(eq(emailContent.emailId, draft.id)),
      ).toEqual([
        expect.objectContaining({
          preview: '',
          textBody: '',
          htmlBody: '',
          parseWarnings: [],
        }),
      ]);
      expect(await db.select().from(email).where(eq(email.id, draft.id))).toEqual([
        expect.objectContaining({
          subject: '',
          preview: '',
          sizeBytes: 0n,
          hasAttachment: false,
          messageIdHeader: null,
          inReplyTo: [],
          references: [],
        }),
      ]);
    }));

  it('counts frozen Submission Blobs against import quota after Draft destruction', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'frozen-import-quota');
      const identity = await createIdentity(h.dependencies, {
        accountId: h.accountId,
        name: 'Quota Sender',
        email: 'quota-sender@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const draft = await createDraft(h.dependencies, {
        accountId: h.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Frozen quota payload',
        textBody: 'body retained only by the Submission snapshot',
        htmlBody: '',
        attachments: [],
      });
      await createSubmission(h.dependencies, {
        accountId: h.accountId,
        emailId: draft.id,
        identityId: identity.id,
        idempotencyKey: 'frozen-import-quota',
        sendAt: null,
      });
      await destroyDraft(h.dependencies, { accountId: h.accountId, emailId: draft.id });

      const raw = new TextEncoder().encode(
        [
          'From: import@example.test',
          'To: recipient@example.test',
          'Message-ID: <frozen-quota-import@example.test>',
          'Date: Thu, 1 Jan 2026 12:00:00 +0000',
          'Subject: New import',
          'Content-Type: text/plain; charset=utf-8',
          '',
          'new import body',
        ].join('\r\n'),
      );
      const importOnlyQuota = BigInt(raw.byteLength);
      await unitOfWork.run((tx) =>
        tx.accounts.update(h.accountId, {
          storageQuotaBytes: importOnlyQuota,
          updatedAt: h.dependencies.clock.now(),
        }),
      );
      const before = await unitOfWork.run((tx) => tx.emails.listByAccount(h.accountId));

      await expect(
        importEmail(h.dependencies, {
          accountId: h.accountId,
          provider: 'fixture',
          remoteEmailId: 'frozen-import-quota',
          remoteThreadId: null,
          raw,
          mailboxIds: [h.inbox.id],
          keywords: [],
          receivedAt: h.dependencies.clock.now(),
        }),
      ).rejects.toMatchObject({ code: 'OVER_QUOTA' });
      expect(await unitOfWork.run((tx) => tx.emails.listByAccount(h.accountId))).toEqual(before);
    }));

  it('stores one Blob metadata row for repeated identical Draft Raw MIME bytes', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'blob-dedup');
      const identity = await createIdentity(h.dependencies, {
        accountId: h.accountId,
        name: 'Dedup Sender',
        email: 'dedup@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const content = {
        accountId: h.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Dedup',
        textBody: 'identical body',
        htmlBody: '',
        attachments: [],
      };
      const draft = await createDraft(h.dependencies, content);
      const updated = await updateDraft(h.dependencies, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content,
      });
      expect(updated.blobId).toBe(draft.blobId);
      const raw = await unitOfWork.run((tx) => tx.blobs.findById(h.accountId, draft.blobId!));
      const rows = await db
        .select()
        .from(blob)
        .where(
          and(
            eq(blob.mailAccountId, h.accountId),
            eq(blob.sha256, raw!.sha256),
            eq(blob.sizeBytes, raw!.sizeBytes),
          ),
        );
      expect(rows).toHaveLength(1);
    }));
});
