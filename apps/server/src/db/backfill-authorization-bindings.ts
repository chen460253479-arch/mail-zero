import { pathToFileURL } from 'node:url';

import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { encryptCredential } from '../lib/credentials/encryption';
import { createZeroOAuthSnapshot } from '../lib/credentials/zero-oauth';
import { createDb, type DB } from '.';
import { authorizationBinding, connection } from './schema';

export type LegacyOAuthConnection = {
  id: string;
  authorizationId: string | null;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
  encryptedCredentialSnapshot: string | null;
};

export interface AuthorizationBackfillRepository {
  listLegacyOAuthConnections(): Promise<LegacyOAuthConnection[]>;
  assertBindingsExist(connectionIds: string[]): Promise<void>;
  saveSnapshot(authorizationId: string, snapshot: string, expiresAt: Date): Promise<void>;
}

type BackfillDependencies = {
  repository: AuthorizationBackfillRepository;
  encryptionKey: string;
};

export const backfillAuthorizationBindings = async ({
  repository,
  encryptionKey,
}: BackfillDependencies): Promise<{ sourceCount: number; populatedCount: number }> => {
  const rows = await repository.listLegacyOAuthConnections();
  await repository.assertBindingsExist(rows.map(({ id }) => id));

  let populatedCount = 0;
  for (const row of rows) {
    if (row.encryptedCredentialSnapshot) {
      populatedCount += 1;
      continue;
    }
    if (!row.authorizationId) throw new Error('Missing authorization binding');

    const snapshot = await encryptCredential(
      createZeroOAuthSnapshot({
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        scope: row.scope,
      }),
      encryptionKey,
    );
    await repository.saveSnapshot(row.authorizationId, snapshot, row.expiresAt);
    populatedCount += 1;
  }

  return { sourceCount: rows.length, populatedCount };
};

export const createAuthorizationBackfillRepository = (
  db: DB,
): AuthorizationBackfillRepository => ({
  async listLegacyOAuthConnections() {
    const rows = await db
      .select({
        id: connection.id,
        authorizationId: authorizationBinding.id,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        scope: connection.scope,
        expiresAt: connection.expiresAt,
        encryptedCredentialSnapshot: authorizationBinding.encryptedCredentialSnapshot,
      })
      .from(connection)
      .leftJoin(
        authorizationBinding,
        eq(authorizationBinding.connectionId, connection.id),
      )
      .where(and(isNotNull(connection.accessToken), isNotNull(connection.refreshToken)));

    return rows.map((row) => {
      if (!row.accessToken || !row.refreshToken) {
        throw new Error('Legacy OAuth connection is missing credentials');
      }
      return {
        ...row,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
      };
    });
  },

  async assertBindingsExist(connectionIds) {
    if (connectionIds.length === 0) return;
    const rows = await db
      .select({ connectionId: authorizationBinding.connectionId })
      .from(authorizationBinding)
      .where(inArray(authorizationBinding.connectionId, connectionIds));
    const boundConnectionIds = new Set(rows.map(({ connectionId }) => connectionId));
    if (connectionIds.some((connectionId) => !boundConnectionIds.has(connectionId))) {
      throw new Error('Missing authorization binding');
    }
  },

  async saveSnapshot(authorizationId, snapshot, expiresAt) {
    const now = new Date();
    await db
      .update(authorizationBinding)
      .set({
        encryptedCredentialSnapshot: snapshot,
        accessTokenExpiresAt: expiresAt,
        credentialFetchedAt: now,
        updatedAt: now,
      })
      .where(eq(authorizationBinding.id, authorizationId));
  },
});

const runFromEnvironment = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!encryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_KEY is required');

  const { db, conn } = createDb(databaseUrl);
  try {
    const result = await backfillAuthorizationBindings({
      repository: createAuthorizationBackfillRepository(db),
      encryptionKey,
    });
    console.log(JSON.stringify(result));
    if (result.sourceCount !== result.populatedCount) process.exitCode = 1;
  } finally {
    await conn.end();
  }
};

const isExecutable =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isExecutable) {
  void runFromEnvironment().catch(() => {
    console.error('Mail authorization backfill failed');
    process.exitCode = 1;
  });
}
