import { describe, expect, it } from 'vitest';

import type {
  BlobId,
  EmailId,
  EmailRecord,
  IdentityId,
  MailAccountId,
  MailboxId,
  ThreadId,
} from '@zero/mail-core';

import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';
import { connection, user } from '../../../src/db/schema';

describe('PostgreSQL mail adapters', () => {
  it('round-trips an account and ordered Mailboxes through one exactly-once transaction', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      await db.insert(user).values({
        id: 'postgres-user-1',
        name: 'Postgres User',
        email: 'postgres-user-1@example.test',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values({
        id: 'postgres-connection-1',
        userId: 'postgres-user-1',
        email: 'postgres-user-1@example.test',
        normalizedEmail: 'postgres-user-1@example.test',
        channelId: 'gmail',
        providerKey: 'test.postgres',
        createdAt: now,
        updatedAt: now,
      });
      const accountId = 'postgres-account-1' as MailAccountId;
      const mailboxIds = ['postgres-mailbox-z', 'postgres-mailbox-a'] as MailboxId[];
      let callbackCount = 0;

      await unitOfWork.run(async (tx) => {
        callbackCount += 1;
        await tx.accounts.insert({
          id: accountId,
          userId: 'postgres-user-1',
          connectionId: 'postgres-connection-1',
          createdAt: now,
          updatedAt: now,
        });
        for (const [sortOrder, id] of mailboxIds.entries()) {
          await tx.mailboxes.insert({
            id,
            accountId,
            parentId: null,
            name: id,
            normalizedName: id,
            kind: 'folder',
            role: null,
            color: null,
            sortOrder,
            isSubscribed: true,
            totalEmails: 0,
            unreadEmails: 0,
            totalThreads: 0,
            unreadThreads: 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          });
        }
      });

      await expect(
        unitOfWork.run(async (tx) => {
          expect(await tx.accounts.findById(accountId)).toMatchObject({
            id: accountId,
            stateVersion: 0n,
          });
          expect((await tx.mailboxes.listByAccount(accountId)).map(({ id }) => id)).toEqual(
            mailboxIds,
          );
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');
      expect(callbackCount).toBe(1);
    }));

  it('serializes same-account locks while another account progresses and rolls back allocations', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const primary = await createPostgresMailTestHarness(db, unitOfWork, 'lock-primary');
      const other = await createPostgresMailTestHarness(db, unitOfWork, 'lock-other');
      let releasePrimary!: () => void;
      const held = new Promise<void>((resolve) => {
        releasePrimary = resolve;
      });
      let primaryLocked!: () => void;
      const locked = new Promise<void>((resolve) => {
        primaryLocked = resolve;
      });
      const holder = unitOfWork.run(async (tx) => {
        await tx.lockAccount(primary.accountId);
        primaryLocked();
        await held;
      });
      await locked;

      let sameStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        sameStarted = resolve;
      });
      const sameAccount = unitOfWork.run(async (tx) => {
        sameStarted();
        await tx.lockAccount(primary.accountId);
        return 'same' as const;
      });
      await started;
      const otherAccount = unitOfWork.run(async (tx) => {
        await tx.lockAccount(other.accountId);
        return 'other' as const;
      });

      await expect(Promise.race([sameAccount, otherAccount])).resolves.toBe('other');
      releasePrimary();
      await expect(Promise.all([holder, sameAccount, otherAccount])).resolves.toEqual([
        undefined,
        'same',
        'other',
      ]);

      await expect(
        unitOfWork.run(async (tx) => {
          await tx.lockAccount(primary.accountId);
          expect(await tx.nextStateVersion(primary.accountId)).toBe(2n);
          throw new Error('rollback allocated state');
        }),
      ).rejects.toThrow('rollback allocated state');
      await expect(
        unitOfWork.run(async (tx) => {
          await tx.lockAccount(primary.accountId);
          return tx.nextStateVersion(primary.accountId);
        }),
      ).resolves.toBe(2n);
    }));

  it('round-trips every ordered and nullable Email aggregate field exactly', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'aggregate');
      const now = harness.dependencies.clock.now();
      const identityId = 'aggregate-identity' as IdentityId;
      const threadId = 'aggregate-thread' as ThreadId;
      const parentId = 'aggregate-parent' as EmailId;
      const blobIds = [
        'aggregate-raw',
        'aggregate-text',
        'aggregate-html',
        'aggregate-part',
      ] as BlobId[];
      const emailRecord = (id: EmailId, overrides: Partial<EmailRecord> = {}): EmailRecord => ({
        id,
        accountId: harness.accountId,
        identityId: null,
        threadId,
        blobId: null,
        messageId: null,
        replyToEmailId: null,
        inReplyTo: [],
        references: [],
        subject: '',
        preview: '',
        sentAt: null,
        receivedAt: now,
        sizeBytes: 0n,
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
        mailboxIds: [harness.inbox.id],
        restoreMailboxIds: [],
        keywords: [],
        ...overrides,
      });
      const child = emailRecord('aggregate-child' as EmailId, {
        identityId,
        blobId: blobIds[0]!,
        messageId: 'aggregate-child@example.test',
        replyToEmailId: parentId,
        inReplyTo: ['first@example.test', 'second@example.test'],
        references: ['root@example.test', 'first@example.test'],
        subject: 'Round trip',
        preview: 'Preview',
        sentAt: new Date('2025-12-31T23:59:00.000Z'),
        sizeBytes: 42n,
        hasAttachment: true,
        sender: [{ name: 'Sender One', email: 'one@example.test' }, { email: 'two@example.test' }],
        from: [{ email: 'from@example.test' }],
        replyTo: [{ name: 'Replies', email: 'replies@example.test' }],
        to: [{ email: 'to@example.test' }],
        cc: [{ email: 'cc@example.test' }],
        bcc: [{ email: 'bcc@example.test' }],
        textBody: 'Round-trip text body',
        htmlBody: '<p>Round-trip HTML body</p>',
        parserVersion: 7,
        parseWarnings: ['warning-b', 'warning-a'],
        parts: [
          {
            id: 'aggregate-part-parent',
            parentPartId: null,
            partPath: '1',
            contentType: 'multipart/mixed',
            charset: null,
            disposition: null,
            filename: null,
            contentId: null,
            rawBlobId: blobIds[0]!,
            offsetStart: 0n,
            encodedLength: 0n,
            decodedLength: 0n,
            transferEncoding: 'binary',
            sizeBytes: 0n,
            kind: 'body',
          },
          {
            id: 'aggregate-part-child',
            parentPartId: 'aggregate-part-parent',
            partPath: '1.2',
            contentType: 'application/octet-stream',
            charset: null,
            disposition: 'attachment',
            filename: 'sample.bin',
            contentId: null,
            rawBlobId: blobIds[0]!,
            offsetStart: 0n,
            encodedLength: 1n,
            decodedLength: 1n,
            transferEncoding: 'binary',
            sizeBytes: 1n,
            kind: 'attachment',
          },
        ],
        mailboxIds: [harness.drafts.id, harness.inbox.id],
        restoreMailboxIds: [harness.inbox.id, harness.drafts.id],
        keywords: ['$flagged', '$seen'],
      });

      await unitOfWork.run(async (tx) => {
        await tx.identities.insert({
          id: identityId,
          accountId: harness.accountId,
          name: null,
          email: 'identity@example.test',
          replyTo: null,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        });
        await tx.threads.insert({
          id: threadId,
          accountId: harness.accountId,
          normalizedSubject: 'round trip',
          latestReceivedAt: now,
          emailCount: 2,
          unreadCount: 2,
          hasAttachment: true,
          participantSummary: null,
          preview: null,
          createdAt: now,
          updatedAt: now,
        });
        for (const [index, id] of blobIds.entries()) {
          await tx.blobs.insert({
            id,
            accountId: harness.accountId,
            kind: 'message_mime',
            sha256: `aggregate-sha-${index}`,
            sizeBytes: BigInt(index + 1),
            contentType: 'application/octet-stream',
            objectKey: `aggregate/${id}`,
            status: 'ready',
            createdAt: now,
            readyAt: now,
            deletedAt: null,
          });
        }
        await tx.emails.insert(emailRecord(parentId));
        expect(await tx.emails.insert(child)).toEqual(child);
      });
      await unitOfWork.run(async (tx) => {
        expect(await tx.emails.findById(harness.accountId, child.id)).toEqual(child);
      });
    }));

  it('round-trips and scopes Blob, Thread, and Identity repository contracts', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const primary = await createPostgresMailTestHarness(db, unitOfWork, 'repository-primary');
      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'repository-foreign');
      const now = primary.dependencies.clock.now();
      const blobId = 'repository-blob' as BlobId;
      const messageBlobId = 'repository-message-blob' as BlobId;
      const threadId = 'repository-thread' as ThreadId;
      const identityId = 'repository-identity' as IdentityId;
      const foreignThreadId = 'repository-foreign-thread' as ThreadId;
      const foreignIdentityId = 'repository-foreign-identity' as IdentityId;

      await unitOfWork.run(async (tx) => {
        await tx.blobs.insert({
          id: blobId,
          accountId: primary.accountId,
          kind: 'attachment',
          sha256: 'repository-blob-digest',
          sizeBytes: 9n,
          contentType: 'text/plain',
          objectKey: 'repository/blob',
          status: 'ready',
          createdAt: now,
          readyAt: now,
          deletedAt: null,
        });
        await tx.blobs.insert({
          id: messageBlobId,
          accountId: primary.accountId,
          kind: 'message_mime',
          sha256: 'repository-blob-digest',
          sizeBytes: 9n,
          contentType: 'message/rfc822',
          objectKey: 'repository/message',
          status: 'ready',
          createdAt: now,
          readyAt: now,
          deletedAt: null,
        });
        await tx.threads.insert({
          id: threadId,
          accountId: primary.accountId,
          normalizedSubject: 'repository thread',
          latestReceivedAt: now,
          emailCount: 1,
          unreadCount: 1,
          hasAttachment: false,
          participantSummary: 'participant',
          preview: 'preview',
          createdAt: now,
          updatedAt: now,
        });
        await tx.threads.insert({
          id: foreignThreadId,
          accountId: foreign.accountId,
          normalizedSubject: 'foreign thread',
          latestReceivedAt: now,
          emailCount: 0,
          unreadCount: 0,
          hasAttachment: false,
          participantSummary: null,
          preview: null,
          createdAt: now,
          updatedAt: now,
        });
        await tx.identities.insert({
          id: identityId,
          accountId: primary.accountId,
          name: 'Repository Identity',
          email: 'repository@example.test',
          replyTo: null,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        });
        await tx.identities.insert({
          id: foreignIdentityId,
          accountId: foreign.accountId,
          name: null,
          email: 'foreign-repository@example.test',
          replyTo: null,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        });
      });

      await unitOfWork.run(async (tx) => {
        expect(await tx.blobs.findById(primary.accountId, blobId)).toMatchObject({
          sha256: 'repository-blob-digest',
          sizeBytes: 9n,
        });
        expect(
          await tx.blobs.findByDigest(
            primary.accountId,
            'attachment',
            'repository-blob-digest',
            9n,
          ),
        ).toMatchObject({ id: blobId });
        expect(
          await tx.blobs.findByDigest(
            primary.accountId,
            'message_mime',
            'repository-blob-digest',
            9n,
          ),
        ).toMatchObject({ id: messageBlobId });
        expect(await tx.blobs.listByAccount(primary.accountId)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: blobId })]),
        );
        expect(
          await tx.blobs.update(primary.accountId, blobId, { status: 'deleting' }),
        ).toMatchObject({ status: 'deleting' });

        expect(await tx.threads.findById(primary.accountId, threadId)).toMatchObject({
          participantSummary: 'participant',
          preview: 'preview',
        });
        expect(await tx.threads.listByAccount(primary.accountId)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: threadId })]),
        );
        expect(await tx.threads.existsOutsideAccount(primary.accountId, foreignThreadId)).toBe(
          true,
        );
        expect(
          await tx.threads.update(primary.accountId, threadId, { unreadCount: 0 }),
        ).toMatchObject({ unreadCount: 0 });

        expect(await tx.identities.findById(primary.accountId, identityId)).toMatchObject({
          name: 'Repository Identity',
          replyTo: null,
        });
        expect(await tx.identities.listByAccount(primary.accountId)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: identityId })]),
        );
        expect(await tx.identities.existsOutsideAccount(primary.accountId, foreignIdentityId)).toBe(
          true,
        );
        expect(
          await tx.identities.update(primary.accountId, identityId, {
            replyTo: 'reply@example.test',
          }),
        ).toMatchObject({ replyTo: 'reply@example.test' });

        await tx.blobs.delete(primary.accountId, blobId);
        await tx.threads.delete(primary.accountId, threadId);
        await tx.identities.delete(primary.accountId, identityId);
        expect(await tx.blobs.findById(primary.accountId, blobId)).toBeNull();
        expect(await tx.threads.findById(primary.accountId, threadId)).toBeNull();
        expect(await tx.identities.findById(primary.accountId, identityId)).toBeNull();
      });
    }));

  it('rolls back Email relations, Change rows, and the allocated account state together', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'rollback-aggregate');
      const now = harness.dependencies.clock.now();
      const threadId = 'rollback-thread' as ThreadId;
      const emailId = 'rollback-email' as EmailId;
      const before = await unitOfWork.run(async (tx) => tx.accounts.findById(harness.accountId));

      await expect(
        unitOfWork.run(async (tx) => {
          await tx.lockAccount(harness.accountId);
          const stateVersion = await tx.nextStateVersion(harness.accountId);
          await tx.threads.insert({
            id: threadId,
            accountId: harness.accountId,
            normalizedSubject: 'rollback',
            latestReceivedAt: now,
            emailCount: 1,
            unreadCount: 1,
            hasAttachment: false,
            participantSummary: null,
            preview: null,
            createdAt: now,
            updatedAt: now,
          });
          await tx.emails.insert({
            id: emailId,
            accountId: harness.accountId,
            identityId: null,
            threadId,
            blobId: null,
            messageId: null,
            replyToEmailId: null,
            inReplyTo: [],
            references: [],
            subject: 'rollback',
            preview: 'rollback',
            sentAt: null,
            receivedAt: now,
            sizeBytes: 1n,
            hasAttachment: false,
            lifecycle: 'received',
            draftRevision: 0,
            createdAt: now,
            updatedAt: now,
            destroyedAt: null,
            sender: [{ email: 'rollback@example.test' }],
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
            mailboxIds: [harness.inbox.id],
            restoreMailboxIds: [harness.drafts.id],
            keywords: ['$seen'],
          });
          await tx.changes.recordChange({
            accountId: harness.accountId,
            stateVersion,
            collection: 'email',
            entityId: emailId,
            changeType: 'created',
            changedProperties: null,
            createdAt: now,
          });
          throw new Error('rollback complete aggregate');
        }),
      ).rejects.toThrow('rollback complete aggregate');

      await unitOfWork.run(async (tx) => {
        expect(await tx.accounts.findById(harness.accountId)).toMatchObject({
          stateVersion: before!.stateVersion,
        });
        expect(await tx.threads.findById(harness.accountId, threadId)).toBeNull();
        expect(await tx.emails.findById(harness.accountId, emailId)).toBeNull();
        expect(
          await tx.changes.queryChanges({
            accountId: harness.accountId,
            afterState: before!.stateVersion,
          }),
        ).toEqual([]);
      });
    }));
});
