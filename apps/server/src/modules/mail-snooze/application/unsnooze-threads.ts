import type { PostgresMailSnoozeCommands } from '../postgres/commands';

export const unsnoozeThreads = (
  input: { accountId: string; threadIds: string[] },
  dependencies: { commands: Pick<PostgresMailSnoozeCommands, 'unsnooze'> },
) => dependencies.commands.unsnooze(input);
