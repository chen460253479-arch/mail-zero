import { createMailApiRuntime } from '../../mail-api/runtime/create-mail-api';
import type { ZeroEnv } from '../../../env';
import { createDb } from '../../../db';

export async function wakeDueMailSnoozes(runtimeEnv: ZeroEnv) {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    return await createMailApiRuntime(db, runtimeEnv).snooze.wakeDue({
      now: new Date(),
      limit: 100,
    });
  } finally {
    await conn.end();
  }
}
