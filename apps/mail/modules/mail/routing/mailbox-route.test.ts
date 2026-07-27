import { resolveMailboxRoute, type RoutableMailbox } from './mailbox-route';
import { describe, expect, it } from 'vitest';

const mailboxes: RoutableMailbox[] = [
  { id: 'mailbox-inbox', kind: 'system', role: 'inbox' },
  { id: 'mailbox-drafts', kind: 'system', role: 'drafts' },
  { id: 'mailbox-sent', kind: 'system', role: 'sent' },
  { id: 'mailbox-trash', kind: 'system', role: 'trash' },
  { id: 'mailbox-junk', kind: 'system', role: 'junk' },
  { id: 'mailbox-archive', kind: 'system', role: 'archive' },
  { id: 'label-customer', kind: 'label', role: null },
];

describe('resolveMailboxRoute', () => {
  it.each([
    ['inbox', 'mailbox-inbox'],
    ['draft', 'mailbox-drafts'],
    ['sent', 'mailbox-sent'],
    ['spam', 'mailbox-junk'],
    ['bin', 'mailbox-trash'],
    ['archive', 'mailbox-archive'],
  ])('maps the %s route to the local system mailbox role', (slug, mailboxId) => {
    expect(resolveMailboxRoute(slug, mailboxes)).toEqual({
      kind: 'mailbox',
      mailboxId,
    });
  });

  it('maps snoozed to the local snooze view without inventing a mailbox', () => {
    expect(resolveMailboxRoute('snoozed', mailboxes)).toEqual({
      kind: 'snoozed',
    });
  });

  it('treats a custom route as an opaque local mailbox id', () => {
    expect(resolveMailboxRoute('label-customer', mailboxes)).toEqual({
      kind: 'mailbox',
      mailboxId: 'label-customer',
    });
  });

  it('does not translate a provider label name into a local mailbox', () => {
    expect(resolveMailboxRoute('CATEGORY_PROMOTIONS', mailboxes)).toEqual({
      kind: 'not-found',
    });
  });
});
