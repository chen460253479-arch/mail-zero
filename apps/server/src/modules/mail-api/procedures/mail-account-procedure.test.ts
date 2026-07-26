import type { MailAccountId, MailAccountRecord, MailCore } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

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

import { createMailAccountProcedure, type OwnedMailApiRuntime } from './mail-account-procedure';
import { router } from '../../../trpc/trpc';

const account = (patch: Partial<MailAccountRecord> = {}): MailAccountRecord => ({
  id: 'account-1' as MailAccountId,
  userId: 'user-1',
  connectionId: 'connection-1',
  status: 'active',
  stateVersion: 1n,
  timezone: 'UTC',
  storageQuotaBytes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...patch,
});

describe('mailAccountProcedure', () => {
  it('opens an owned active account runtime and always closes it', async () => {
    const close = vi.fn(async () => undefined);
    const open = vi.fn(
      async (): Promise<OwnedMailApiRuntime> => ({
        account: account(),
        core: {} as MailCore,
        outbound: {} as OwnedMailApiRuntime['outbound'],
        db: {} as OwnedMailApiRuntime['db'],
        close,
      }),
    );
    const testRouter = router({
      read: createMailAccountProcedure(open)
        .input(z.object({ accountId: z.string(), value: z.number() }))
        .query(({ ctx, input }) => ({
          accountId: ctx.mailApi.account.id,
          value: input.value,
        })),
    });

    await expect(
      testRouter
        .createCaller({
          c: { env: {}, var: {} } as never,
          sessionUser: { id: 'user-1' } as never,
          auth: {} as never,
        })
        .read({ accountId: 'account-1', value: 7 }),
    ).resolves.toEqual({ accountId: 'account-1', value: 7 });
    expect(open).toHaveBeenCalledWith('user-1', 'account-1', {});
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not open a runtime without an authenticated session', async () => {
    const open = vi.fn();
    const testRouter = router({
      read: createMailAccountProcedure(open).query(() => true),
    });

    await expect(
      testRouter
        .createCaller({
          c: { env: {}, var: {} } as never,
          sessionUser: undefined,
          auth: {} as never,
        })
        .read({ accountId: 'account-1' }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(open).not.toHaveBeenCalled();
  });
});
