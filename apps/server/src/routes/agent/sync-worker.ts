import { connection as connectionSchema } from '../../db/schema';
import {
  connectionToDriver,
  findConnectionWithAuthorization,
} from '../../lib/server-utils';
import { withRetry } from '../../lib/gmail-rate-limit';
import { DurableObject } from 'cloudflare:workers';
import type { ParsedMessage } from '../../types';
import type { ZeroEnv } from '../../env';
import { createDb } from '../../db';
import { Effect } from 'effect';

export class ThreadSyncWorker extends DurableObject<ZeroEnv> {
  constructor(state: DurableObjectState, env: ZeroEnv) {
    super(state, env);
  }

  private getThreadKey(connectionId: string, threadId: string) {
    return `${connectionId}/${threadId}.json`;
  }

  public async syncThread(
    connection: typeof connectionSchema.$inferSelect,
    threadId: string,
  ): Promise<ParsedMessage | undefined> {
    const { db, conn } = createDb(this.env.HYPERDRIVE.connectionString);
    const record = await findConnectionWithAuthorization(db, connection.id).finally(() =>
      conn.end(),
    );
    if (!record) throw new Error('Mailbox authorization is missing');
    const driver = await connectionToDriver(record);

    const thread = await Effect.runPromise(
      withRetry(Effect.tryPromise(() => driver.get(threadId))),
    );

    await this.env.THREADS_BUCKET.put(
      this.getThreadKey(connection.id, threadId),
      JSON.stringify(thread),
      {
        customMetadata: {
          threadId,
        },
      },
    );

    return thread.latest;
  }
}
