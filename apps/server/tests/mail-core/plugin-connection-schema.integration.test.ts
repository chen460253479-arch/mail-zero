import { describe, expect, it } from 'vitest';

import { authorizationBinding, connection, user } from '../../src/db/schema';
import { withMailTestDatabase } from './helpers/database';

const now = new Date('2026-07-26T00:00:00.000Z');

describe('plugin-neutral Connection schema', () => {
  it('stores OAuth and Basic mailboxes without OAuth fields on Connection', () =>
    withMailTestDatabase(async ({ db }) => {
      await db.insert(user).values({
        id: 'plugin-user',
        name: 'Plugin User',
        email: 'plugin-user@example.test',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values([
        {
          id: 'plugin-gmail',
          userId: 'plugin-user',
          email: 'owner@example.test',
          normalizedEmail: 'owner@example.test',
          channelId: 'gmail',
          providerKey: 'gmail',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'plugin-imap',
          userId: 'plugin-user',
          email: 'owner@example.test',
          normalizedEmail: 'owner@example.test',
          channelId: 'imap_smtp',
          providerKey: 'imap_smtp',
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await db.insert(authorizationBinding).values([
        {
          id: 'plugin-gmail-auth',
          connectionId: 'plugin-gmail',
          authSource: 'zero_oauth',
          credentialType: 'oauth2',
          encryptedCredentialSnapshot: 'encrypted-oauth',
          accessTokenExpiresAt: new Date('2026-07-26T01:00:00.000Z'),
          credentialFetchedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'plugin-imap-auth',
          connectionId: 'plugin-imap',
          authSource: 'manual',
          credentialType: 'basic',
          encryptedCredentialSnapshot: 'encrypted-basic',
          accessTokenExpiresAt: null,
          credentialFetchedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const mailboxes = await db.query.connection.findMany({
        where: (fields, { eq }) => eq(fields.userId, 'plugin-user'),
      });
      expect(mailboxes).toHaveLength(2);
      expect(mailboxes.map(({ channelId, providerKey }) => ({ channelId, providerKey }))).toEqual(
        expect.arrayContaining([
          { channelId: 'gmail', providerKey: 'gmail' },
          { channelId: 'imap_smtp', providerKey: 'imap_smtp' },
        ]),
      );
      const basic = await db.query.authorizationBinding.findFirst({
        where: (fields, { eq }) => eq(fields.connectionId, 'plugin-imap'),
      });
      expect(basic).toMatchObject({
        authSource: 'manual',
        credentialType: 'basic',
        accessTokenExpiresAt: null,
      });
    }));

  it('enforces plugin identity, lifecycle, and channel-scoped uniqueness', () =>
    withMailTestDatabase(async ({ db }) => {
      await db.insert(user).values({
        id: 'plugin-constraint-user',
        name: 'Plugin Constraint User',
        email: 'plugin-constraint@example.test',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values({
        id: 'plugin-constraint-gmail',
        userId: 'plugin-constraint-user',
        email: 'owner@example.test',
        normalizedEmail: 'owner@example.test',
        channelId: 'gmail',
        providerKey: 'gmail',
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        db.insert(connection).values({
          id: 'plugin-constraint-duplicate',
          userId: 'plugin-constraint-user',
          email: 'owner@example.test',
          normalizedEmail: 'owner@example.test',
          channelId: 'gmail',
          providerKey: 'gmail',
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        db.insert(connection).values({
          id: 'plugin-invalid-provider',
          userId: 'plugin-constraint-user',
          email: 'invalid@example.test',
          normalizedEmail: 'invalid@example.test',
          channelId: 'gmail',
          providerKey: 'GMAIL!',
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.insert(connection).values({
          id: 'plugin-invalid-status',
          userId: 'plugin-constraint-user',
          email: 'status@example.test',
          normalizedEmail: 'status@example.test',
          channelId: 'gmail',
          providerKey: 'gmail',
          status: 'paused' as typeof connection.$inferInsert.status,
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.insert(authorizationBinding).values({
          id: 'plugin-invalid-auth',
          connectionId: 'plugin-constraint-gmail',
          authSource: 'shared_secret' as typeof authorizationBinding.$inferInsert.authSource,
          credentialType: 'oauth2',
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toMatchObject({ code: '23514' });
    }));
});
