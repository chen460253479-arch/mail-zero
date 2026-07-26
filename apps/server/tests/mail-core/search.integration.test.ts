import type { EmailRecord, EmailId, MailAccountId, MailboxId, ThreadId } from '@zero/mail-core';
import { queryEmails } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { PostgresSearchStore } from '../../src/modules/mail/search/postgres-search-store';
import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';
import { connection, user } from '../../src/db/schema';

describe('PostgreSQL mail search', () => {
  it('finds full-body-only text in-account without returning destroyed Email', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const now = new Date('2026-01-01T00:00:00.000Z');
      const accountId = 'search-account' as MailAccountId;
      const mailboxId = 'search-mailbox' as MailboxId;
      const threadId = 'search-thread' as ThreadId;
      await db.insert(user).values({
        id: 'search-user',
        name: 'Search User',
        email: 'search@example.test',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values({
        id: 'search-connection',
        userId: 'search-user',
        email: 'search@example.test',
        normalizedEmail: 'search@example.test',
        channelId: 'search-channel' as typeof connection.$inferInsert.channelId,
        providerKey: 'test.postgres',
        createdAt: now,
        updatedAt: now,
      });
      await unitOfWork.run(async (tx) => {
        await tx.accounts.insert({
          id: accountId,
          userId: 'search-user',
          connectionId: 'search-connection',
          createdAt: now,
          updatedAt: now,
        });
        await tx.mailboxes.insert({
          id: mailboxId,
          accountId,
          parentId: null,
          name: 'Inbox',
          normalizedName: 'inbox',
          kind: 'system',
          role: 'inbox',
          color: null,
          sortOrder: 0,
          isSubscribed: true,
          totalEmails: 0,
          unreadEmails: 0,
          totalThreads: 0,
          unreadThreads: 0,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        await tx.threads.insert({
          id: threadId,
          accountId,
          normalizedSubject: 'ordinary',
          latestReceivedAt: now,
          emailCount: 2,
          unreadCount: 2,
          hasAttachment: false,
          participantSummary: null,
          preview: null,
          createdAt: now,
          updatedAt: now,
        });
        for (const [id, destroyedAt] of [
          ['search-visible', null],
          ['search-destroyed', now],
        ] as const) {
          await tx.emails.insert({
            id: id as EmailId,
            accountId,
            identityId: null,
            threadId,
            blobId: null,
            messageId: null,
            replyToEmailId: null,
            inReplyTo: [],
            references: [],
            subject: 'Ordinary subject',
            preview: 'short',
            sentAt: null,
            receivedAt: now,
            sizeBytes: 10n,
            hasAttachment: false,
            lifecycle: 'received',
            draftRevision: 0,
            createdAt: now,
            updatedAt: now,
            destroyedAt,
            sender: [{ name: 'Sender', email: 'Sender@Example.Test' }],
            from: [],
            replyTo: [],
            to: [],
            cc: [],
            bcc: [],
            textBlobId: null,
            htmlBlobId: null,
            parserVersion: 1,
            parseWarnings: [],
            parts: [],
            mailboxIds: [mailboxId],
            restoreMailboxIds: [],
            keywords: ['$seen'],
          });
          await tx.emails.publishSearchDocument(accountId, id as EmailId, {
            subject: 'ordinary subject',
            addressText: 'sender sender@example.test',
            bodyText: 'only the body contains orbital-marker',
          });
        }
      });
      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'search-foreign');
      const foreignThreadId = 'search-foreign-thread' as ThreadId;
      await unitOfWork.run(async (tx) => {
        await tx.threads.insert({
          id: foreignThreadId,
          accountId: foreign.accountId,
          normalizedSubject: 'foreign',
          latestReceivedAt: now,
          emailCount: 1,
          unreadCount: 1,
          hasAttachment: false,
          participantSummary: null,
          preview: null,
          createdAt: now,
          updatedAt: now,
        });
        const foreignEmail: EmailRecord = {
          id: 'search-foreign-email' as EmailId,
          accountId: foreign.accountId,
          identityId: null,
          threadId: foreignThreadId,
          blobId: null,
          messageId: null,
          replyToEmailId: null,
          inReplyTo: [],
          references: [],
          subject: 'foreign',
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
          textBlobId: null,
          htmlBlobId: null,
          parserVersion: 1,
          parseWarnings: [],
          parts: [],
          mailboxIds: [foreign.inbox.id],
          restoreMailboxIds: [],
          keywords: [],
        };
        await tx.emails.insert(foreignEmail);
        await tx.emails.publishSearchDocument(foreign.accountId, foreignEmail.id, {
          subject: 'foreign',
          addressText: '',
          bodyText: 'only the body contains orbital-marker',
        });
      });

      const result = await queryEmails(
        { unitOfWork, searchStore: new PostgresSearchStore(db) },
        {
          accountId,
          filter: { text: 'orbital-marker' },
          sort: { property: 'receivedAt', direction: 'asc' },
          limit: 20,
          cursor: null,
        },
      );

      expect(result.emailIds).toEqual(['search-visible']);
    }));

  it('applies every filter and typed keyset sort with deterministic ties and nulls last', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'search-matrix');
      const threadId = 'search-matrix-thread' as ThreadId;
      const at = (day: number) =>
        new Date(`2026-01-${day.toString().padStart(2, '0')}T00:00:00.000Z`);
      const record = (id: string, overrides: Partial<EmailRecord>): EmailRecord => ({
        id: id as EmailId,
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
        receivedAt: at(1),
        sizeBytes: 0n,
        hasAttachment: false,
        lifecycle: 'received',
        draftRevision: 0,
        createdAt: at(1),
        updatedAt: at(1),
        destroyedAt: null,
        sender: [],
        from: [],
        replyTo: [],
        to: [],
        cc: [],
        bcc: [],
        textBlobId: null,
        htmlBlobId: null,
        parserVersion: 1,
        parseWarnings: [],
        parts: [],
        mailboxIds: [harness.inbox.id],
        restoreMailboxIds: [],
        keywords: [],
        ...overrides,
      });
      const records = [
        record('email-a', {
          subject: 'Bravo',
          receivedAt: at(1),
          sentAt: at(3),
          sizeBytes: 10n,
          hasAttachment: true,
          sender: [{ email: 'Target@Example.Test' }, { email: ' U\u0308SER@EXAMPLE.TEST ' }],
          keywords: ['$seen'],
        }),
        record('email-b', {
          subject: 'alpha',
          receivedAt: at(2),
          sentAt: at(2),
          sizeBytes: 20n,
          sender: [{ email: 'other@example.test' }],
          to: [{ email: 'target@example.test' }],
          keywords: ['$seen'],
        }),
        record('email-c', {
          subject: 'Alpha',
          receivedAt: at(2),
          sentAt: null,
          sizeBytes: 20n,
          sender: [{ email: 'target@example.test' }],
          mailboxIds: [harness.drafts.id],
          keywords: ['$flagged'],
          lifecycle: 'draft',
        }),
      ];
      await unitOfWork.run(async (tx) => {
        await tx.threads.insert({
          id: threadId,
          accountId: harness.accountId,
          normalizedSubject: 'matrix',
          latestReceivedAt: at(2),
          emailCount: 3,
          unreadCount: 3,
          hasAttachment: true,
          participantSummary: null,
          preview: null,
          createdAt: at(1),
          updatedAt: at(2),
        });
        for (const email of records) {
          await tx.emails.insert(email);
          await tx.emails.publishSearchDocument(harness.accountId, email.id, {
            subject: email.subject.toLocaleLowerCase('und'),
            addressText: email.sender.map(({ email: address }) => address).join(' '),
            bodyText: `release body ${email.id}`,
          });
        }
      });
      const query = (
        filter: Parameters<typeof queryEmails>[1]['filter'],
        sort: NonNullable<Parameters<typeof queryEmails>[1]['sort']> = {
          property: 'receivedAt',
          direction: 'asc',
        },
        limit = 20,
        cursor: string | null = null,
      ) =>
        queryEmails(harness.dependencies, {
          accountId: harness.accountId,
          filter,
          sort,
          limit,
          cursor,
        });
      for (const [label, filter, expected] of [
        ['mailbox', { mailboxId: harness.inbox.id }, ['email-a', 'email-b']],
        ['keyword', { hasKeyword: '$flagged' }, ['email-c']],
        ['negative keyword', { notKeyword: '$seen' }, ['email-c']],
        ['lifecycle', { lifecycle: 'draft' }, ['email-c']],
        ['after', { after: at(1) }, ['email-b', 'email-c']],
        ['before', { before: at(2) }, ['email-a']],
        ['address', { address: ' TARGET@EXAMPLE.TEST ' }, ['email-a', 'email-b', 'email-c']],
        ['unicode address', { address: 'ÜSER@example.test' }, ['email-a']],
        ['from', { from: ' TARGET@EXAMPLE.TEST ' }, ['email-a', 'email-c']],
        ['to', { to: ' TARGET@EXAMPLE.TEST ' }, ['email-b']],
        ['attachment', { hasAttachment: true }, ['email-a']],
        ['text', { text: 'body email-b' }, ['email-b']],
      ] as const) {
        const result = await query(filter);
        expect(result.emailIds, label).toEqual(expected);
      }
      for (const [sort, expected] of [
        [{ property: 'receivedAt', direction: 'desc' }, ['email-b', 'email-c', 'email-a']],
        [{ property: 'sentAt', direction: 'asc' }, ['email-b', 'email-a', 'email-c']],
        [{ property: 'sentAt', direction: 'desc' }, ['email-a', 'email-b', 'email-c']],
        [{ property: 'size', direction: 'asc' }, ['email-a', 'email-b', 'email-c']],
        [{ property: 'subject', direction: 'asc' }, ['email-b', 'email-c', 'email-a']],
      ] as const) {
        expect((await query({}, sort)).emailIds).toEqual(expected);
      }
      for (const sort of [
        { property: 'sentAt', direction: 'asc' },
        { property: 'size', direction: 'asc' },
        { property: 'subject', direction: 'asc' },
      ] as const) {
        const expected = (await query({}, sort)).emailIds;
        const paged: EmailId[] = [];
        let cursor: string | null = null;
        do {
          const page = await query({}, sort, 1, cursor);
          paged.push(...page.emailIds);
          cursor = page.nextCursor;
        } while (cursor !== null);
        expect(paged, `${sort.property} typed keyset`).toEqual(expected);
      }

      const first = await query({}, { property: 'receivedAt', direction: 'asc' }, 2);
      expect(first.emailIds).toEqual(['email-a', 'email-b']);
      await unitOfWork.run(async (tx) => {
        const inserted = record('email-bb', {
          subject: 'between',
          receivedAt: at(2),
          sizeBytes: 15n,
        });
        await tx.emails.insert(inserted);
        await tx.emails.publishSearchDocument(harness.accountId, inserted.id, {
          subject: inserted.subject,
          addressText: '',
          bodyText: '',
        });
      });
      expect(
        (await query({}, { property: 'receivedAt', direction: 'asc' }, 2, first.nextCursor))
          .emailIds,
      ).toEqual(['email-bb', 'email-c']);
    }));
});
