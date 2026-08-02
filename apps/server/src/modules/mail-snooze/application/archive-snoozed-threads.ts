import type { PostgresMailSnoozeCommands } from '../postgres/commands';

export const archiveSnoozedThreads = (
  input: { accountId: string; threadIds: string[] },
  dependencies: { commands: Pick<PostgresMailSnoozeCommands, 'archive'> },
) => dependencies.commands.archive(input);
