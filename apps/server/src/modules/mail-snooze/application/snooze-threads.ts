import type { PostgresMailSnoozeCommands } from '../postgres/commands';

export type SnoozeThreadsInput = {
  accountId: string;
  threadIds: string[];
  wakeAt: Date;
};

export const snoozeThreads = (
  input: SnoozeThreadsInput,
  dependencies: { commands: Pick<PostgresMailSnoozeCommands, 'snooze'> },
) => dependencies.commands.snooze(input);
