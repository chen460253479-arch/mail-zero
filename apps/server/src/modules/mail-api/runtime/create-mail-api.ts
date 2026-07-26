import type { Id, MailAccountId, MailAccountRecord, MailCore } from '@zero/mail-core';
import { ulid } from 'ulid';

import { preprocessEmailHtml } from '../../../lib/email-processor';
import { createMailCoreRuntime, R2BlobStore } from '../../mail';
import { MailApiError } from '../errors/mail-api-error';
import { createDb, type DB } from '../../../db';

export type MailApiEnvironment = {
  HYPERDRIVE: { connectionString: string };
  THREADS_BUCKET: ConstructorParameters<typeof R2BlobStore>[0];
};

export type MailApiRuntime = {
  core: MailCore;
  db: DB;
};

export type OwnedMailApiRuntime = MailApiRuntime & {
  account: MailAccountRecord;
  close(): Promise<void>;
};

export function createMailApiRuntime(db: DB, runtimeEnv: MailApiEnvironment): MailApiRuntime {
  return {
    db,
    core: createMailCoreRuntime({
      db,
      blobStore: new R2BlobStore(runtimeEnv.THREADS_BUCKET),
      blobReadAuditSink: { record: async () => undefined },
      clock: { now: () => new Date() },
      idFactory: {
        next<Kind extends string>() {
          return ulid() as Id<Kind>;
        },
      },
      sanitizeHtml: preprocessEmailHtml,
    }),
  };
}

export async function openOwnedMailApiRuntime(
  userId: string,
  accountId: MailAccountId,
  runtimeEnv: MailApiEnvironment,
): Promise<OwnedMailApiRuntime> {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  const runtime = createMailApiRuntime(db, runtimeEnv);
  try {
    const account = await runtime.core.getAccount({ accountId });
    if (account.userId !== userId) {
      throw new MailApiError({
        code: 'NOT_FOUND',
        retryable: false,
        requestId: crypto.randomUUID(),
      });
    }
    if (account.status !== 'active') {
      throw new MailApiError({
        code: 'ACCOUNT_NOT_ACTIVE',
        retryable: false,
        requestId: crypto.randomUUID(),
      });
    }
    return {
      ...runtime,
      account,
      close: async () => {
        await conn.end();
      },
    };
  } catch (error) {
    await conn.end().catch(() => undefined);
    throw error;
  }
}
