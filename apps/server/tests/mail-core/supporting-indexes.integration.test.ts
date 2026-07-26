import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { mailbox } from '../../src/db/schema';
import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

describe('mail repository supporting indexes', () => {
  it('filters soft-deleted Mailboxes before returning the ordered account list', async () => {
    await withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'active-mailbox-list');
      await db
        .update(mailbox)
        .set({ deletedAt: new Date('2026-01-02T00:00:00.000Z') })
        .where(eq(mailbox.id, harness.drafts.id));

      const listed = await unitOfWork.run((stores) =>
        stores.mailboxes.listByAccount(harness.accountId),
      );

      expect(listed.map(({ id }) => id)).toContain(harness.inbox.id);
      expect(listed.map(({ id }) => id)).not.toContain(harness.drafts.id);
    });
  });
});
