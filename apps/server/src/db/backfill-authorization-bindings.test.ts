import { describe, expect, it, vi } from 'vitest';

import {
  backfillAuthorizationBindings,
  type LegacyOAuthConnection,
} from './backfill-authorization-bindings';
import { decryptCredential } from '../lib/credentials/encryption';

const encryptionKey = Buffer.alloc(32, 4).toString('base64');
const expiresAt = new Date('2026-07-24T00:00:00.000Z');

const legacyRow: LegacyOAuthConnection = {
  id: 'connection-1',
  authorizationId: 'authorization-1',
  accessToken: 'access',
  refreshToken: 'refresh',
  scope: 'mail',
  expiresAt,
  encryptedCredentialSnapshot: null,
};

const createRepository = (rows: LegacyOAuthConnection[] = [legacyRow]) => ({
  listLegacyOAuthConnections: vi.fn().mockResolvedValue(rows),
  assertBindingsExist: vi.fn().mockResolvedValue(undefined),
  saveSnapshot: vi.fn().mockResolvedValue(undefined),
  clearLegacyCredentials: vi.fn().mockResolvedValue(undefined),
});

describe('authorization binding backfill', () => {
  it('encrypts every legacy OAuth credential into its authorization binding', async () => {
    const repository = createRepository();

    await backfillAuthorizationBindings({ repository, encryptionKey });

    const encrypted = repository.saveSnapshot.mock.calls[0]?.[1];
    await expect(decryptCredential(encrypted, encryptionKey)).resolves.toEqual({
      type: 'oauth2',
      accessToken: 'access',
      refreshToken: 'refresh',
      scope: 'mail',
    });
    expect(repository.saveSnapshot).toHaveBeenCalledWith(
      'authorization-1',
      expect.any(String),
      expiresAt,
    );
    expect(repository.clearLegacyCredentials).toHaveBeenCalledWith('connection-1');
  });

  it('skips a binding that already has an encrypted snapshot', async () => {
    const repository = createRepository([
      { ...legacyRow, encryptedCredentialSnapshot: 'already-encrypted' },
    ]);

    await backfillAuthorizationBindings({ repository, encryptionKey });

    expect(repository.saveSnapshot).not.toHaveBeenCalled();
    expect(repository.clearLegacyCredentials).toHaveBeenCalledWith('connection-1');
  });

  it('fails before writing when a legacy connection has no authorization binding', async () => {
    const repository = createRepository();
    repository.assertBindingsExist.mockRejectedValue(new Error('Missing authorization binding'));

    await expect(backfillAuthorizationBindings({ repository, encryptionKey })).rejects.toThrow(
      'Missing authorization binding',
    );
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('reports matching source and populated binding counts', async () => {
    const repository = createRepository([
      legacyRow,
      {
        ...legacyRow,
        id: 'connection-2',
        authorizationId: 'authorization-2',
        encryptedCredentialSnapshot: 'already-encrypted',
      },
    ]);

    await expect(backfillAuthorizationBindings({ repository, encryptionKey })).resolves.toEqual({
      sourceCount: 2,
      populatedCount: 2,
    });
  });
});
