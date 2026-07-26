import { createMailCoreDependenciesForEnvironment } from '../../../runtime/mail/core';
import { createPostgresMailSnoozeRepository } from '../postgres/repository';
import { createPostgresMailSnoozeCommands } from '../postgres/commands';
import { createMailSnoozeRuntime } from './create-mail-snooze';
import type { ZeroEnv } from '../../../env';
import { createDb } from '../../../db';

export async function wakeDueMailSnoozes(runtimeEnv: ZeroEnv) {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const clock = { now: () => new Date() };
    return await createMailSnoozeRuntime({
      commands: createPostgresMailSnoozeCommands({
        db,
        mailCoreDependencies: createMailCoreDependenciesForEnvironment(db, runtimeEnv),
        clock,
      }),
      repository: createPostgresMailSnoozeRepository(db),
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
