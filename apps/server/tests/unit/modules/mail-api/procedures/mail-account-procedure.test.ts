import type { MailAccountId, MailAccountRecord, MailCore } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  createMailAccountProcedure,
  type OwnedMailApiRuntime,
} from '../../../../../src/modules/mail-api/procedures/mail-account-procedure';
import { router } from '../../../../../src/trpc/trpc';

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
    const services = {};
    const open = vi.fn(
      async (): Promise<OwnedMailApiRuntime> => ({
        account: account(),
        core: {} as MailCore,
        outbound: {} as OwnedMailApiRuntime['outbound'],
        snooze: {} as OwnedMailApiRuntime['snooze'],
        db: {} as OwnedMailApiRuntime['db'],
        cursorSigningKey: 'procedure-test-cursor-key',
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
          c: { var: { services } } as never,
          sessionUser: { id: 'user-1' } as never,
          auth: {} as never,
        })
        .read({ accountId: 'account-1', value: 7 }),
    ).resolves.toEqual({ accountId: 'account-1', value: 7 });
    expect(open).toHaveBeenCalledWith('user-1', 'account-1', services);
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

  it('allows an external session to open an account in its grant scope', async () => {
    const close = vi.fn(async () => undefined);
    const open = vi.fn(
      async (): Promise<OwnedMailApiRuntime> => ({
        account: account({
          id: 'allowed-account' as MailAccountId,
          userId: 'zero-external-integration',
        }),
        core: {} as MailCore,
        outbound: {} as OwnedMailApiRuntime['outbound'],
        snooze: {} as OwnedMailApiRuntime['snooze'],
        db: {} as OwnedMailApiRuntime['db'],
        cursorSigningKey: 'procedure-test-cursor-key',
        close,
      }),
    );
    const testRouter = router({
      read: createMailAccountProcedure(open).query(({ ctx }) => ({
        kind: ctx.mailAccess.kind,
      })),
    });

    await expect(
      testRouter
        .createCaller({
          c: { var: { services: {} } } as never,
          sessionUser: undefined,
          externalSession: {
            id: 'external-session-1',
            ownerUserId: 'zero-external-integration',
            scopes: [
              {
                nangoConnectionId: 'connect-1',
                connectionId: 'connection-1',
                mailAccountId: 'allowed-account',
              },
            ],
            activeConnectionId: 'connection-1',
            expiresAt: new Date('2026-08-20T00:00:00.000Z'),
            updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          },
          auth: {} as never,
        })
        .read({ accountId: 'allowed-account' }),
    ).resolves.toEqual({ kind: 'external' });
    expect(open).toHaveBeenCalledWith('zero-external-integration', 'allowed-account', {});
  });

  it('rejects an account outside the external grant scope', async () => {
    const open = vi.fn();
    const testRouter = router({
      read: createMailAccountProcedure(open).query(() => true),
    });

    await expect(
      testRouter
        .createCaller({
          c: { var: { services: {} } } as never,
          sessionUser: undefined,
          externalSession: {
            id: 'external-session-1',
            ownerUserId: 'zero-external-integration',
            scopes: [
              {
                nangoConnectionId: 'connect-1',
                connectionId: 'connection-1',
                mailAccountId: 'allowed-account',
              },
            ],
            activeConnectionId: 'connection-1',
            expiresAt: new Date('2026-08-20T00:00:00.000Z'),
            updatedAt: new Date('2026-07-29T00:00:00.000Z'),
          },
          auth: {} as never,
        })
        .read({ accountId: 'other-account' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps user ownership failures mapped to NOT_FOUND', async () => {
    const open = vi.fn(async () => {
      throw new TRPCError({ code: 'NOT_FOUND' });
    });
    const testRouter = router({
      read: createMailAccountProcedure(open).query(() => true),
    });

    await expect(
      testRouter
        .createCaller({
          c: { var: { services: {} } } as never,
          sessionUser: { id: 'user-1' } as never,
          externalSession: undefined,
          auth: {} as never,
        })
        .read({ accountId: 'other-users-account' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
