import type { MailAccountRecord } from '@zero/mail-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailApiError } from '../../../../../src/modules/mail-api/errors/mail-api-error';

const runtimeMocks = vi.hoisted(() => ({
  openAccessible: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('../../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openAccessibleMailApiRuntime: runtimeMocks.openAccessible,
}));

import { crmRouter } from '../../../../../src/modules/mail-api/routers/crm';
import { router } from '../../../../../src/trpc/trpc';

const account = {
  id: 'account-crm',
  userId: 'crm-user',
  status: 'active',
} as MailAccountRecord;

const callerContext = {
  c: { env: {}, var: {} } as never,
  sessionUser: { id: account.userId, role: 'user' } as never,
  authSession: { authMethod: 'password' } as never,
  auth: {} as never,
};

describe('CRM Router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests customer creation through an owned mailbox runtime', async () => {
    const request = vi.fn(async () => ({
      status: 'accepted' as const,
      eventId: 'event-manual-1',
    }));
    runtimeMocks.openAccessible.mockResolvedValue({
      account,
      customerCreation: { request },
      close: runtimeMocks.close,
    });
    const caller = router({ crm: crmRouter }).createCaller(callerContext);

    await expect(
      caller.crm.requestCustomerCreation({
        accountId: account.id,
        messageId: 'email-1',
      }),
    ).resolves.toEqual({ status: 'accepted', eventId: 'event-manual-1' });
    expect(request).toHaveBeenCalledWith({
      accountId: account.id,
      messageId: 'email-1',
    });
    expect(runtimeMocks.openAccessible).toHaveBeenCalledWith(
      {
        actorUserId: account.userId,
        isAdministrator: false,
        accountId: account.id,
      },
      undefined,
    );
    expect(runtimeMocks.close).toHaveBeenCalledOnce();
  });

  it('rejects unauthenticated and inaccessible account requests before the service runs', async () => {
    const unauthenticated = router({ crm: crmRouter }).createCaller({
      c: { env: {}, var: {} } as never,
      auth: {} as never,
    });
    await expect(
      unauthenticated.crm.requestCustomerCreation({
        accountId: account.id,
        messageId: 'email-1',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    runtimeMocks.openAccessible.mockRejectedValue(
      new MailApiError({ code: 'NOT_FOUND', retryable: false, requestId: 'request-1' }),
    );
    const authenticated = router({ crm: crmRouter }).createCaller(callerContext);
    await expect(
      authenticated.crm.requestCustomerCreation({
        accountId: 'account-other',
        messageId: 'email-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
