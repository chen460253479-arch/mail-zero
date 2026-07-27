import { expect, type Page } from '@playwright/test';

const legacyMailProcedures = [
  'mail.listThreads',
  'mail.get',
  'mail.send',
  'mail.unsend',
  'mail.modifyLabels',
  'mail.markAsRead',
  'mail.markAsUnread',
  'mail.bulkArchive',
  'mail.bulkDelete',
  'drafts.',
  'labels.',
];

export function observeMailApi(page: Page) {
  const procedures = new Set<string>();
  const legacyRequests: string[] = [];

  page.on('request', (request) => {
    let url = request.url();
    try {
      url = decodeURIComponent(url);
    } catch {
      // A malformed non-mail URL is irrelevant to this observer.
    }

    if (!url.includes('/trpc/')) return;
    for (const procedure of [
      'mail.account.list',
      'mail.mailbox.get',
      'mail.view.threadPage',
      'mail.view.threadDetail',
      'mail.email.set',
      'mail.submission.set',
      'mail.action.updateThreads',
    ]) {
      if (url.includes(procedure)) procedures.add(procedure);
    }
    if (legacyMailProcedures.some((procedure) => url.includes(procedure))) {
      legacyRequests.push(url);
    }
  });

  return {
    expectProcedure: async (procedure: string) => {
      await expect.poll(() => procedures.has(procedure)).toBe(true);
    },
    expectNoLegacyRequests: () => {
      expect(legacyRequests, 'the UI must not call removed mail/drafts/labels procedures').toEqual(
        [],
      );
    },
  };
}
