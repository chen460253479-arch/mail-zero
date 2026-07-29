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
import type { RuntimeServices } from '../../../runtime/node/services';
import type { MailOutboundRuntime } from '../../mail-outbound';
import { MailApiError } from '../errors/mail-api-error';
import type { DB } from '../../../db';

export type MailApiEnvironment = RuntimeServices;

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

export function createMailApiRuntime(services: MailApiEnvironment): MailApiRuntime {
  const { db } = services.database;
  const coreResources = {
    blobStore: services.blobStore,
    cursorSigningKey: services.config.betterAuthSecret,
  };
  const core = createMailCoreForEnvironment(db, coreResources);
  const clock = { now: () => new Date() };
  return {
    db,
    cursorSigningKey: services.config.betterAuthSecret,
    core,
    outbound: createMailOutboundRuntimeForEnvironment(db, {
      environment: services.environment,
      nango: services.nango,
      blobStore: services.blobStore,
      taskQueue: services.taskQueue,
    }),
    snooze: createMailSnoozeRuntime({
      commands: createPostgresMailSnoozeCommands({
        db,
        mailCoreDependencies: createMailCoreDependenciesForEnvironment(db, coreResources),
        clock,
      }),
      repository: createPostgresMailSnoozeRepository(db),
      newLeaseOwner: () => crypto.randomUUID(),
      leaseForMs: 5 * 60_000,
    }),
  };
}

export async function openMailApiRuntime(
  services: MailApiEnvironment,
): Promise<OpenMailApiRuntime> {
  return {
    ...createMailApiRuntime(services),
    close: async () => undefined,
  };
}

export async function openOwnedMailApiRuntime(
  userId: string,
  accountId: MailAccountId,
  services: MailApiEnvironment,
): Promise<OwnedMailApiRuntime> {
  const runtime = await openMailApiRuntime(services);
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
