import type { MailAccountId, MailAccountRecord, MailCore } from '@zero/mail-core';

import {
  createMailCoreDependenciesForEnvironment,
  createMailCoreForEnvironment,
} from '../../../runtime/mail/core';
import {
  createMailSnoozeRuntime,
  type MailSnoozeRuntime,
} from '../../mail-snooze/runtime/create-mail-snooze';
import { createPostgresMailSnoozeRepository } from '../../mail-snooze/postgres/repository';
import { createMailOutboundRuntimeForEnvironment } from '../../../runtime/mail/outbound';
import { createPostgresMailSnoozeCommands } from '../../mail-snooze/postgres/commands';
import type { MailOutboundRuntime } from '../../mail-outbound';
import { MailApiError } from '../errors/mail-api-error';
import { createDb, type DB } from '../../../db';
import type { ZeroEnv } from '../../../env';

export type MailApiEnvironment = ZeroEnv;

export type MailApiRuntime = {
  core: MailCore;
  outbound: MailOutboundRuntime;
  snooze: MailSnoozeRuntime;
  db: DB;
  cursorSigningKey: string;
};

export type OpenMailApiRuntime = MailApiRuntime & {
  close(): Promise<void>;
};

export type OwnedMailApiRuntime = OpenMailApiRuntime & {
  account: MailAccountRecord;
};

export function createMailApiRuntime(db: DB, runtimeEnv: MailApiEnvironment): MailApiRuntime {
  const core = createMailCoreForEnvironment(db, runtimeEnv);
  const clock = { now: () => new Date() };
  return {
    db,
    cursorSigningKey: runtimeEnv.BETTER_AUTH_SECRET,
    core,
    outbound: createMailOutboundRuntimeForEnvironment(db, runtimeEnv),
    snooze: createMailSnoozeRuntime({
      commands: createPostgresMailSnoozeCommands({
        db,
        mailCoreDependencies: createMailCoreDependenciesForEnvironment(db, runtimeEnv),
        clock,
      }),
      repository: createPostgresMailSnoozeRepository(db),
      newLeaseOwner: () => crypto.randomUUID(),
      leaseForMs: 5 * 60_000,
    }),
  };
}

export async function openMailApiRuntime(
  runtimeEnv: MailApiEnvironment,
): Promise<OpenMailApiRuntime> {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  return {
    ...createMailApiRuntime(db, runtimeEnv),
    close: async () => {
      await conn.end();
    },
  };
}

export async function openOwnedMailApiRuntime(
  userId: string,
  accountId: MailAccountId,
  runtimeEnv: MailApiEnvironment,
): Promise<OwnedMailApiRuntime> {
  const runtime = await openMailApiRuntime(runtimeEnv);
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
    };
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
}
