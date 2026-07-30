import type { EmailRecord, MailAccountRecord, MailCore } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  openAccessible: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('../../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openAccessibleMailApiRuntime: runtimeMocks.openAccessible,
}));

import { emailRouter } from '../../../../../src/modules/mail-api/routers/email';
import { router } from '../../../../../src/trpc/trpc';

const account = {
  id: 'account-email-router',
  userId: 'email-user',
  status: 'active',
} as MailAccountRecord;

const email = {
  id: 'email-1',
  accountId: account.id,
  lifecycle: 'received',
  keywords: ['$seen', '$flagged'],
  mailboxIds: ['mailbox-inbox'],
} as EmailRecord;

describe('Email Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes JMAP null/true maps as transaction-safe Core deltas', async () => {
    const setEmails = vi.fn(async () => ({
      oldState: '4',
      newState: '5',
      created: {},
      updated: {},
      destroyed: [],
      notCreated: {},
      notUpdated: {},
      notDestroyed: {},
    }));
    const core = {
      getEmail: vi.fn(async () => email),
      setEmails,
    } as unknown as MailCore;
    runtimeMocks.openAccessible.mockResolvedValue({
      account,
      core,
      db: {},
      close: runtimeMocks.close,
    });
    const caller = router({ email: emailRouter }).createCaller({
      c: { env: {}, var: {} } as never,
      sessionUser: { id: account.userId, role: 'user' } as never,
      authSession: { authMethod: 'password' } as never,
      auth: {} as never,
    });

    await caller.email.set({
      accountId: account.id,
      update: {
        [email.id]: {
          keywords: { $seen: null, $important: true },
          mailboxIds: { 'mailbox-inbox': null, 'mailbox-archive': true },
        },
      },
    });

    expect(setEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          [email.id]: expect.objectContaining({
            addKeywords: ['$important'],
            removeKeywords: ['$seen'],
            addMailboxIds: ['mailbox-archive'],
            removeMailboxIds: ['mailbox-inbox'],
          }),
        },
      }),
    );
    expect(core.getEmail).not.toHaveBeenCalled();
    expect(runtimeMocks.close).toHaveBeenCalledOnce();
  });
});
