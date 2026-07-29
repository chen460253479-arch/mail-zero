import postgres, { type Sql } from 'postgres';

import { createDrizzle, type DB } from '../../db';

export type RuntimeDatabase = {
  db: DB;
  sql: Sql;
  close(): Promise<void>;
};

export const createRuntimeDatabase = (
  databaseUrl: string,
  options: { max?: number } = {},
): RuntimeDatabase => {
  const sql = postgres(databaseUrl, { max: options.max ?? 10 });
  const db = createDrizzle(sql);
  let closePromise: Promise<void> | undefined;

  return {
    db,
    sql,
    close() {
      closePromise ??= sql.end();
      return closePromise;
    },
  };
};
