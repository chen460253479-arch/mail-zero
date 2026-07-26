import type { EmailRecord, MailAccountRecord, MailCore } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  openOwned: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('cloudflare:workers', () => {
  class RuntimeBase {}
  return {
    env: {},
    DurableObject: RuntimeBase,
    RpcTarget: RuntimeBase,
    WorkerEntrypoint: RuntimeBase,
    WorkflowEntrypoint: RuntimeBase,
  };
});

vi.mock('../runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openOwnedMailApiRuntime: runtimeMocks.openOwned,
}));

import { router } from '../../../trpc/trpc';
import { emailRouter } from './email';

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

  it('maps JMAP null/true maps into deterministic Core replacements', async () => {
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
    runtimeMocks.openOwned.mockResolvedValue({
      account,
      core,
      db: {},
      close: runtimeMocks.close,
    });
    const caller = router({ email: emailRouter }).createCaller({
      c: { env: {}, var: {} } as never,
      sessionUser: { id: account.userId } as never,
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
            keywords: ['$flagged', '$important'],
            mailboxIds: ['mailbox-archive'],
          }),
        },
      }),
    );
    expect(runtimeMocks.close).toHaveBeenCalledOnce();
  });
});
