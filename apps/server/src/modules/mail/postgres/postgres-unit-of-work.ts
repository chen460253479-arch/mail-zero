import {
  MailCoreError,
  type MailAccountId,
  type MailTransaction,
  type MailUnitOfWork,
} from '@zero/mail-core';
import { eq, sql } from 'drizzle-orm';

import { createPostgresMailNotificationRepository } from '../../mail-notifications/postgres/repository';
import { runAdapter, type MailDatabase } from './repositories/database';
import { createPostgresRepositories } from './repositories';
import { mailAccount } from './schema';
import type { DB } from '../../../db';

export class CallbackFailure {
  constructor(readonly error: unknown) {}
}

export const createPostgresMailTransaction = (
  transaction: MailDatabase,
  allocated: Map<MailAccountId, bigint>,
  options: {
    notificationsEnabled: boolean;
  } = {
    notificationsEnabled: false,
  },
): MailTransaction => ({
  ...createPostgresRepositories(transaction),
  notifications: createPostgresMailNotificationRepository(transaction as DB, {
    enabled: options.notificationsEnabled,
  }),
  lockAccount: (accountId) =>
    runAdapter(async () => {
      const rows = await transaction
        .select({ id: mailAccount.id })
        .from(mailAccount)
        .where(eq(mailAccount.id, accountId))
        .for('update')
        .limit(1);
      if (rows.length === 0) {
        throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: accountId });
      }
    }),
  nextStateVersion: (accountId) =>
    runAdapter(async () => {
      const existing = allocated.get(accountId);
      if (existing !== undefined) {
        return existing;
      }
      const rows = await transaction
        .update(mailAccount)
        .set({ stateVersion: sql`${mailAccount.stateVersion} + 1` })
        .where(eq(mailAccount.id, accountId))
        .returning({ stateVersion: mailAccount.stateVersion });
      const stateVersion = rows[0]?.stateVersion;
      if (stateVersion === undefined) {
        throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: accountId });
      }
      allocated.set(accountId, stateVersion);
      return stateVersion;
    }),
});

export async function runPostgresMailTransaction<Result>(
  db: DB,
  operation: (tx: MailTransaction, database: MailDatabase) => Promise<Result>,
  options: {
    notificationsEnabled: boolean;
  } = {
    notificationsEnabled: false,
  },
): Promise<Result> {
  try {
    return await db.transaction(async (transaction) => {
      const allocated = new Map<MailAccountId, bigint>();
      try {
        return await operation(
          createPostgresMailTransaction(transaction, allocated, options),
          transaction,
        );
      } catch (error) {
        throw new CallbackFailure(error);
      }
    });
  } catch (error) {
    if (error instanceof CallbackFailure) {
      throw error.error;
    }
    return runAdapter(() => Promise.reject(error));
  }
}

export class PostgresMailUnitOfWork implements MailUnitOfWork {
  constructor(
    private readonly db: DB,
    private readonly options: {
      notificationsEnabled: boolean;
    } = {
      notificationsEnabled: false,
    },
  ) {}

  run<Result>(operation: (tx: MailTransaction) => Promise<Result>): Promise<Result> {
    return runPostgresMailTransaction(this.db, (tx) => operation(tx), this.options);
  }
}
