import type { MailAccountId, MailTransaction } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { PostgresMailUnitOfWork } from '../../src/modules/mail/postgres/postgres-unit-of-work';
import type { DB } from '../../src/db';

const accountId = 'unit-of-work-error-account' as MailAccountId;

const dbWithTransaction = (transaction: unknown): DB =>
  ({
    transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
  }) as unknown as DB;

describe('PostgresMailUnitOfWork error boundary', () => {
  it.each([
    [
      'lockAccount',
      {
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({
                limit: () => Promise.reject(new Error('secret lock driver message')),
              }),
            }),
          }),
        }),
      },
      (tx: MailTransaction) => tx.lockAccount(accountId),
    ],
    [
      'nextStateVersion',
      {
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => Promise.reject(new Error('secret state driver message')),
            }),
          }),
        }),
      },
      (tx: MailTransaction) => tx.nextStateVersion(accountId),
    ],
  ] as const)('sanitizes an owned %s driver rejection', async (_label, transaction, operation) => {
    const unitOfWork = new PostgresMailUnitOfWork(dbWithTransaction(transaction));

    await expect(
      unitOfWork.run(async (tx) => {
        await operation(tx);
      }),
    ).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
      message: 'STORAGE_FAILURE',
      details: {},
    });
  });
});
