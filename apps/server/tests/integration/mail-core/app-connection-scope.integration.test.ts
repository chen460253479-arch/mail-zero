import { describe, expect, it } from 'vitest';

import { connection, note, user } from '../../../src/db/schema';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('application note Connection scope', () => {
  it('allows equal thread IDs in different Connections without cross-account collision', () =>
    withMailTestDatabase(async ({ db }) => {
      const now = new Date('2026-07-26T00:00:00.000Z');
      await db.insert(user).values({
        id: 'scope-user',
        name: 'Scope User',
        email: 'scope@example.test',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values([
        {
          id: 'scope-connection-a',
          userId: 'scope-user',
          email: 'a@example.test',
          normalizedEmail: 'a@example.test',
          channelId: 'gmail',
          providerKey: 'gmail',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'scope-connection-b',
          userId: 'scope-user',
          email: 'b@example.test',
          normalizedEmail: 'b@example.test',
          channelId: 'gmail',
          providerKey: 'gmail',
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await db.insert(note).values([
        {
          id: 'scope-note-a',
          userId: 'scope-user',
          connectionId: 'scope-connection-a',
          threadId: 'provider-thread-1',
          content: 'A',
        },
        {
          id: 'scope-note-b',
          userId: 'scope-user',
          connectionId: 'scope-connection-b',
          threadId: 'provider-thread-1',
          content: 'B',
        },
      ]);
      await expect(
        db.query.note.findMany({
          where: (fields, { and, eq }) =>
            and(
              eq(fields.userId, 'scope-user'),
              eq(fields.connectionId, 'scope-connection-a'),
              eq(fields.threadId, 'provider-thread-1'),
            ),
        }),
      ).resolves.toEqual([expect.objectContaining({ id: 'scope-note-a', content: 'A' })]);
    }));
});
