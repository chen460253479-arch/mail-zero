import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { importEmail, queryEmails } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

const raw = new Uint8Array(
  readFileSync(resolve(process.cwd(), '../../packages/mail-core/tests/fixtures/simple.eml')),
);

describe('PostgreSQL import integration', () => {
  it('merges bridged Threads through indexed references and one bounded Email move', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'thread-merge');
      const makeRaw = (messageId: string, references: string[]) =>
        new TextEncoder().encode(
          [
            'From: sender@example.test',
            'To: recipient@example.test',
            `Message-ID: <${messageId}>`,
            ...(references.length === 0
              ? []
              : [
                  `In-Reply-To: <${references.at(-1)}>`,
                  `References: ${references.map((id) => `<${id}>`).join(' ')}`,
                ]),
            'Date: Thu, 1 Jan 2026 10:00:00 +0000',
            'Subject: PostgreSQL merge',
            'Content-Type: text/plain; charset=utf-8',
            '',
            'merge',
          ].join('\r\n'),
        );
      const importRaw = (remoteEmailId: string, messageId: string, references: string[]) =>
        importEmail(harness.dependencies, {
          accountId: harness.accountId,
          provider: 'fixture-provider',
          remoteEmailId,
          remoteThreadId: null,
          raw: makeRaw(messageId, references),
          mailboxIds: [harness.inbox.id],
          keywords: [],
          receivedAt: new Date('2026-01-01T10:00:00.000Z'),
        });
      const first = await importRaw('thread-merge-first', 'thread-merge-first@example.test', []);
      const second = await importRaw('thread-merge-second', 'thread-merge-second@example.test', []);
      const bridge = await importRaw('thread-merge-bridge', 'thread-merge-bridge@example.test', [
        'thread-merge-first@example.test',
        'thread-merge-second@example.test',
      ]);

      await unitOfWork.run(async (tx) => {
        const emails = await tx.emails.listByAccount(harness.accountId);
        expect(emails.map(({ id }) => id)).toEqual(
          expect.arrayContaining([first.emailId, second.emailId, bridge.emailId]),
        );
        expect(new Set(emails.map(({ threadId }) => threadId))).toHaveLength(1);
        expect(await tx.threads.listByAccount(harness.accountId)).toHaveLength(1);
      });
    }));

  it('uses the deterministic Email ID tie-break for equal-time Thread projections', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'thread-tie-break');
      const receivedAt = new Date('2026-01-01T10:00:00.000Z');
      const makeRaw = (messageId: string, body: string, inReplyTo: string | null) =>
        new TextEncoder().encode(
          [
            'From: sender@example.test',
            'To: recipient@example.test',
            `Message-ID: <${messageId}>`,
            ...(inReplyTo === null ? [] : [`In-Reply-To: <${inReplyTo}>`]),
            'Date: Thu, 1 Jan 2026 10:00:00 +0000',
            'Subject: Equal PostgreSQL time',
            'Content-Type: text/plain; charset=utf-8',
            '',
            body,
          ].join('\r\n'),
        );
      const first = await importEmail(harness.dependencies, {
        accountId: harness.accountId,
        provider: 'fixture-provider',
        remoteEmailId: 'thread-tie-first',
        remoteThreadId: null,
        raw: makeRaw('thread-tie-first@example.test', 'first projection', null),
        mailboxIds: [harness.inbox.id],
        keywords: [],
        receivedAt,
      });
      const second = await importEmail(harness.dependencies, {
        accountId: harness.accountId,
        provider: 'fixture-provider',
        remoteEmailId: 'thread-tie-second',
        remoteThreadId: null,
        raw: makeRaw(
          'thread-tie-second@example.test',
          'second projection',
          'thread-tie-first@example.test',
        ),
        mailboxIds: [harness.inbox.id],
        keywords: [],
        receivedAt,
      });

      await unitOfWork.run(async (tx) => {
        const firstEmail = (await tx.emails.findById(harness.accountId, first.emailId))!;
        const secondEmail = (await tx.emails.findById(harness.accountId, second.emailId))!;
        expect(secondEmail.threadId).toBe(firstEmail.threadId);
        expect(secondEmail.id.localeCompare(firstEmail.id)).toBeGreaterThan(0);
        expect(await tx.threads.findById(harness.accountId, firstEmail.threadId)).toMatchObject({
          preview: 'second projection',
        });
      });
    }));

  it('deduplicates concurrent remote import and publishes its body projection atomically', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork);
      const input = {
        accountId: harness.accountId,
        provider: 'fixture-provider',
        remoteEmailId: 'remote-concurrent-1',
        remoteThreadId: null,
        raw,
        mailboxIds: [harness.inbox.id],
        keywords: ['$seen'],
        receivedAt: new Date('2026-01-01T10:00:00.000Z'),
      };

      const results = await Promise.all([
        importEmail(harness.dependencies, input),
        importEmail(harness.dependencies, input),
      ]);

      expect(new Set(results.map(({ emailId }) => emailId))).toHaveLength(1);
      expect(results.filter(({ created }) => created)).toHaveLength(1);
      await expect(
        queryEmails(harness.dependencies, {
          accountId: harness.accountId,
          filter: { text: 'hello simple fixture' },
          sort: { property: 'receivedAt', direction: 'asc' },
          limit: 20,
          cursor: null,
        }),
      ).resolves.toMatchObject({ emailIds: [results[0]!.emailId] });
      await unitOfWork.run(async (tx) => {
        expect(await tx.emails.listByAccount(harness.accountId)).toHaveLength(1);
        expect(await tx.accounts.findById(harness.accountId)).toMatchObject({
          stateVersion: 2n,
        });
      });
    }));
});
