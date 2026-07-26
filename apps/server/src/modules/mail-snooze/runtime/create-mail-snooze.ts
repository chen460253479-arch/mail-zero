import type { PostgresMailSnoozeCommands } from '../postgres/commands';
import { unsnoozeThreads } from '../application/unsnooze-threads';
import { wakeDueSnoozes } from '../application/wake-due-snoozes';
import { snoozeThreads } from '../application/snooze-threads';
import type { MailSnoozeRepository } from '../domain/snooze';

export const createMailSnoozeRuntime = (dependencies: {
  commands: PostgresMailSnoozeCommands;
  repository: MailSnoozeRepository;
  newLeaseOwner(): string;
  leaseForMs: number;
}) => ({
  snooze: (input: { accountId: string; threadIds: string[]; wakeAt: Date }) =>
    snoozeThreads(input, dependencies),
  unsnooze: (input: { accountId: string; threadIds: string[] }) =>
    unsnoozeThreads(input, dependencies),
  wakeDue: (input: { now: Date; limit: number }) =>
    wakeDueSnoozes(
      {
        ...input,
        leaseOwner: dependencies.newLeaseOwner(),
        leaseForMs: dependencies.leaseForMs,
      },
      dependencies,
    ),
});

export type MailSnoozeRuntime = ReturnType<typeof createMailSnoozeRuntime>;
