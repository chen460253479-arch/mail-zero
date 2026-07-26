import { createPostgresMailSnoozeRepository } from '../postgres/repository';
import { createMailCoreForEnvironment } from '../../../runtime/mail/core';
import { createMailSnoozeRuntime } from './create-mail-snooze';
import type { ZeroEnv } from '../../../env';
import { createDb } from '../../../db';

export async function wakeDueMailSnoozes(runtimeEnv: ZeroEnv) {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const core = createMailCoreForEnvironment(db, runtimeEnv);
    return await createMailSnoozeRuntime({
      core,
      repository: createPostgresMailSnoozeRepository(db),
      clock: { now: () => new Date() },
      newLeaseOwner: () => crypto.randomUUID(),
      leaseForMs: 5 * 60_000,
    }).wakeDue({
      now: new Date(),
      limit: 100,
    });
  } finally {
    await conn.end();
  }
}
