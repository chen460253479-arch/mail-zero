import type { MailAccountId, MailTransaction } from '@zero/mail-core';

import {
  CallbackFailure,
  PostgresMailUnitOfWork,
  createPostgresMailTransaction,
} from '../../mail/postgres/postgres-unit-of-work';
import {
  createMailOutboundRepository,
  type MailOutboundRepository,
  type MailOutboundRepositoryFactories,
} from './repository';
import { MailOutboundError } from '../domain/errors';
import type { DB } from '../../../db';

export interface MailOutboundTransaction {
  mail: MailTransaction;
  outbound: MailOutboundRepository;
}

export interface MailOutboundUnitOfWork {
  run<Result>(operation: (tx: MailOutboundTransaction) => Promise<Result>): Promise<Result>;
}

export class PostgresMailOutboundUnitOfWork implements MailOutboundUnitOfWork {
  readonly mailUnitOfWork: PostgresMailUnitOfWork;

  constructor(
    private readonly db: DB,
    private readonly factories: MailOutboundRepositoryFactories,
  ) {
    this.mailUnitOfWork = new PostgresMailUnitOfWork(db);
  }

  async run<Result>(operation: (tx: MailOutboundTransaction) => Promise<Result>): Promise<Result> {
    try {
      return await this.db.transaction(async (transaction) => {
        try {
          return await operation({
            mail: createPostgresMailTransaction(transaction, new Map<MailAccountId, bigint>()),
            outbound: createMailOutboundRepository(transaction, this.factories),
          });
        } catch (error) {
          throw new CallbackFailure(error);
        }
      });
    } catch (error) {
      if (error instanceof CallbackFailure) {
        throw error.error;
      }
      if (error instanceof MailOutboundError) {
        throw error;
      }
      throw new MailOutboundError('MAIL_OUTBOUND_STORAGE_FAILURE', 'transient');
    }
  }
}
