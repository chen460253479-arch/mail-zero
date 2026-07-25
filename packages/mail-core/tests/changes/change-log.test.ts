import { describe, expect, expectTypeOf, it } from 'vitest';

import { updateEmail, type ChangeType, type MailChange } from '../../src';
import { createSeededEmailHarness } from '../helpers/email-harness';

describe('local Change log', () => {
  it('records one Email, Thread, and affected Mailbox set at the returned state', async () => {
    const h = await createSeededEmailHarness();

    const result = await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [h.archiveId],
      removeMailboxIds: [h.inboxId],
      addKeywords: ['$seen'],
    });

    const changes = (await h.inspect.changes()).filter(
      ({ stateVersion }) => stateVersion === result.stateVersion,
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'email',
          entityId: h.emailId,
          changeType: 'updated',
          changedProperties: ['mailboxIds', 'keywords'],
        }),
        expect.objectContaining({
          collection: 'thread',
          entityId: h.threadId,
          changeType: 'updated',
          changedProperties: ['unreadCount'],
        }),
        expect.objectContaining({
          collection: 'mailbox',
          entityId: h.inboxId,
          changeType: 'updated',
        }),
        expect.objectContaining({
          collection: 'mailbox',
          entityId: h.archiveId,
          changeType: 'updated',
        }),
      ]),
    );
    expect(changes.every(({ stateVersion }) => stateVersion === result.stateVersion)).toBe(true);
  });

  it('exports public Change types without adapter details', () => {
    expectTypeOf<ChangeType>().toEqualTypeOf<'created' | 'updated' | 'destroyed'>();
    expectTypeOf<MailChange>().toHaveProperty('stateVersion');
    expectTypeOf<MailChange>().not.toHaveProperty('objectKey');
  });
});
