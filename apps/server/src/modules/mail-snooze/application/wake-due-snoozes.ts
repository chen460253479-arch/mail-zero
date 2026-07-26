import type { PostgresMailSnoozeCommands } from '../postgres/commands';
import type { MailSnoozeRepository } from '../domain/snooze';

export async function wakeDueSnoozes(
  input: { now: Date; limit: number; leaseOwner: string; leaseForMs: number },
  dependencies: {
    commands: Pick<PostgresMailSnoozeCommands, 'wakeClaimed'>;
    repository: Pick<MailSnoozeRepository, 'claimDue' | 'release'>;
  },
) {
  const claimed = await dependencies.repository.claimDue(input);
  let completed = 0;
  for (const snooze of claimed) {
    try {
      if (await dependencies.commands.wakeClaimed(snooze, input.leaseOwner, input.now)) {
        completed += 1;
      }
    } catch {
      await dependencies.repository.release({
        accountId: snooze.accountId,
        threadId: snooze.threadId,
        leaseOwner: input.leaseOwner,
        now: input.now,
      });
    }
  }
  return { claimed: claimed.length, completed };
}
