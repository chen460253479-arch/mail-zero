import { z } from 'zod';

import { decryptCredential, encryptCredential } from './encryption';
import type { ResolvedCredential } from '../mail-channel/types';
import { authorizationBinding } from '../../db/schema';
import type { NangoCredential } from '../nango/types';
import type { NangoClient } from '../nango/client';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../../db';

const refreshWindowMs = 15 * 60 * 1000;

const nangoSnapshotSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('oauth2'),
    accessToken: z.string().min(1),
    scope: z.string(),
  }),
  z.object({
    type: z.literal('basic'),
    username: z.string(),
    password: z.string(),
    host: z.string().min(1),
    port: z.number().int().positive(),
    secure: z.boolean(),
  }),
]);

type NangoCredentialSnapshot = z.infer<typeof nangoSnapshotSchema>;

export type NangoCredentialState = {
  encryptedCredentialSnapshot: string | null;
  accessTokenExpiresAt: Date | null;
  credentialFetchedAt?: Date | null;
};

export type NangoAuthorizationRecord = NangoCredentialState & {
  id: string;
  authSource: 'nango';
  nangoConnectionId: string | null;
  nangoProviderConfigKey: string | null;
};

export interface NangoCredentialRepository {
  refreshWithLock(
    bindingId: string,
    refresh: (latest: NangoCredentialState) => Promise<NangoCredentialState>,
  ): Promise<NangoCredentialState>;
  invalidate(bindingId: string): Promise<void>;
}

export const createNangoCredentialRepository = (db: DB): NangoCredentialRepository => ({
  refreshWithLock: async (bindingId, refresh) =>
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bindingId}, 0))`);
      const binding = await tx.query.authorizationBinding.findFirst({
        where: eq(authorizationBinding.id, bindingId),
      });
      if (!binding || binding.authSource !== 'nango') {
        throw new Error('Nango authorization binding is unavailable');
      }

      const state = await refresh({
        encryptedCredentialSnapshot: binding.encryptedCredentialSnapshot,
        accessTokenExpiresAt: binding.accessTokenExpiresAt,
        credentialFetchedAt: binding.credentialFetchedAt,
      });
      await tx
        .update(authorizationBinding)
        .set({ ...state, updatedAt: new Date() })
        .where(eq(authorizationBinding.id, bindingId));
      return state;
    }),
  invalidate: async (bindingId) => {
    await db
      .update(authorizationBinding)
      .set({
        encryptedCredentialSnapshot: null,
        accessTokenExpiresAt: null,
        credentialFetchedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(authorizationBinding.id, bindingId));
  },
});

export type NangoCredentialResolverOptions = {
  client: Pick<NangoClient, 'getConnection'>;
  repository: NangoCredentialRepository;
  forceRefresh?: boolean;
};

const inFlightRefreshes = new Map<string, Promise<ResolvedCredential>>();

export const shouldRefresh = (expiresAt: Date | null, now: Date): boolean =>
  expiresAt !== null && expiresAt.getTime() - now.getTime() <= refreshWindowMs;

export const createNangoCredentialSnapshot = (
  credential: NangoCredentialSnapshot | ResolvedCredential,
): NangoCredentialSnapshot => nangoSnapshotSchema.parse(credential);

const readSnapshot = async (
  state: NangoCredentialState,
  encryptionKey: string,
): Promise<ResolvedCredential | null> => {
  if (!state.encryptedCredentialSnapshot) return null;
  const snapshot = nangoSnapshotSchema.parse(
    await decryptCredential(state.encryptedCredentialSnapshot, encryptionKey),
  );
  return snapshot.type === 'oauth2'
    ? { ...snapshot, expiresAt: state.accessTokenExpiresAt }
    : snapshot;
};

const canUseCached = (
  credential: ResolvedCredential | null,
  expiresAt: Date | null,
  now: Date,
): credential is ResolvedCredential =>
  credential !== null && (credential.type === 'basic' || !shouldRefresh(expiresAt, now));

const parseExpiresAt = (value: string | number | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const timestamp =
    typeof value === 'number' ? (value < 1_000_000_000_000 ? value * 1000 : value) : value;
  const result = new Date(timestamp);
  return Number.isNaN(result.getTime()) ? null : result;
};

const resolveBasicCredential = (
  credential: Extract<NangoCredential, { type: 'BASIC' }>,
): ResolvedCredential => {
  const connection = z
    .object({
      host: z.string().min(1),
      port: z.number().int().positive(),
      secure: z.boolean(),
    })
    .parse(credential.raw);
  return {
    type: 'basic',
    username: credential.username,
    password: credential.password,
    ...connection,
  };
};

export const resolveFetchedNangoCredential = (
  credential: NangoCredential,
): { credential: ResolvedCredential; expiresAt: Date | null } => {
  if (credential.type === 'OAUTH2') {
    return {
      credential: {
        type: 'oauth2',
        accessToken: credential.access_token,
        expiresAt: parseExpiresAt(credential.expires_at),
        scope: '',
      },
      expiresAt: parseExpiresAt(credential.expires_at),
    };
  }
  if (credential.type === 'BASIC') {
    return { credential: resolveBasicCredential(credential), expiresAt: null };
  }
  throw new Error(`Unsupported Nango credential type: ${credential.type}`);
};

export const resolveNangoCredential = async (
  authorization: NangoAuthorizationRecord,
  encryptionKey: string,
  options: NangoCredentialResolverOptions,
  now = new Date(),
): Promise<ResolvedCredential> => {
  const cached = await readSnapshot(authorization, encryptionKey);
  if (!options.forceRefresh && canUseCached(cached, authorization.accessTokenExpiresAt, now)) {
    return cached;
  }

  const existingRefresh = inFlightRefreshes.get(authorization.id);
  if (existingRefresh) return await existingRefresh;

  const refresh = options.repository
    .refreshWithLock(authorization.id, async (latest) => {
      const latestCredential = await readSnapshot(latest, encryptionKey);
      if (
        !options.forceRefresh &&
        canUseCached(latestCredential, latest.accessTokenExpiresAt, now)
      ) {
        return latest;
      }
      if (!authorization.nangoConnectionId || !authorization.nangoProviderConfigKey) {
        throw new Error('Nango connection reference is incomplete');
      }

      const connection = await options.client.getConnection(
        authorization.nangoConnectionId,
        authorization.nangoProviderConfigKey,
      );
      const resolved = resolveFetchedNangoCredential(connection.credentials);
      return {
        encryptedCredentialSnapshot: await encryptCredential(
          createNangoCredentialSnapshot(resolved.credential),
          encryptionKey,
        ),
        accessTokenExpiresAt: resolved.expiresAt,
        credentialFetchedAt: now,
      };
    })
    .then(async (state) => {
      const credential = await readSnapshot(state, encryptionKey);
      if (!credential) throw new Error('Nango credential refresh did not persist a snapshot');
      return credential;
    });

  inFlightRefreshes.set(authorization.id, refresh);
  try {
    return await refresh;
  } catch (error) {
    if (
      !options.forceRefresh &&
      cached?.type === 'oauth2' &&
      authorization.accessTokenExpiresAt &&
      authorization.accessTokenExpiresAt.getTime() > now.getTime()
    ) {
      return cached;
    }
    throw error;
  } finally {
    inFlightRefreshes.delete(authorization.id);
  }
};

export const invalidateNangoCredential = async (
  authorizationId: string,
  repository: NangoCredentialRepository,
): Promise<void> => {
  await repository.invalidate(authorizationId);
};
