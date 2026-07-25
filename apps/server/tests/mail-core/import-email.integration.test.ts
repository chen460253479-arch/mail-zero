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
