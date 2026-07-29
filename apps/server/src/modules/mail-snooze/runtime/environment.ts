import { createMailCoreDependenciesForEnvironment } from '../../../runtime/mail/core';
import { createPostgresMailSnoozeRepository } from '../postgres/repository';
import type { MailCoreRuntimeResources } from '../../../runtime/mail/core';
import { createPostgresMailSnoozeCommands } from '../postgres/commands';
import { createMailSnoozeRuntime } from './create-mail-snooze';
import type { DB } from '../../../db';

export async function wakeDueMailSnoozes(db: DB, resources: MailCoreRuntimeResources) {
  const clock = { now: () => new Date() };
  return await createMailSnoozeRuntime({
    commands: createPostgresMailSnoozeCommands({
      db,
      mailCoreDependencies: createMailCoreDependenciesForEnvironment(db, resources),
      clock,
    }),
    repository: createPostgresMailSnoozeRepository(db),
    newLeaseOwner: () => crypto.randomUUID(),
    leaseForMs: 5 * 60_000,
  }).wakeDue({
    now: new Date(),
    limit: 100,
  });
}
