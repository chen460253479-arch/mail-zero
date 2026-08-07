import type { MailAccountId } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { createPostgresConnectionRepository } from '../../src/modules/mail-accounts/postgres/connection-repository';
import { createPostgresMailNotificationRepository } from '../../src/modules/mail-notifications/postgres/repository';
import { connectNangoMailbox } from '../../src/modules/mail-accounts/application/connect-nango-mailbox';
import { deliverPendingEvent } from '../../src/modules/mail-notifications/application/deliver-pending';
import { createExternalIntegrationRouter } from '../../src/modules/external-integration/http/router';
import { bindNangoMailbox } from '../../src/modules/mail-accounts/application/bind-nango-mailbox';
import { createUserWorkspaceService } from '../../src/modules/user-workspace/service';
import { createAccountRouter } from '../../src/modules/mail-api/routers/account';
import { createMailCoreForEnvironment } from '../../src/runtime/mail/core';
import { configureUserWorkspaceService } from '../../src/lib/server-utils';
import { createGmailPlugin } from '../../src/mail-channel/gmail/plugin';
import type { RuntimeServices } from '../../src/runtime/node/services';
import { withMailTestDatabase } from '../helpers/mail-core/database';
import type { RuntimeConfig } from '../../src/runtime/node/config';
import { settingsRouter } from '../../src/trpc/routes/settings';
import { MemoryBlobStore } from '../../src/modules/mail';
import { userRouter } from '../../src/trpc/routes/user';
import { mailAccount, user } from '../../src/db/schema';
import type { HonoContext } from '../../src/ctx';
import { createAuth } from '../../src/lib/auth';
import { router } from '../../src/trpc/trpc';

const config = {
  nodeEnv: 'local',
  publicAppUrl: 'https://mail.zero.example.test',
  publicBackendUrl: 'https://api.zero.example.test',
  betterAuthSecret: 'integration-test-better-auth-secret-000000',
  credentialEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
  betterAuthTrustedOrigins: ['https://mail.zero.example.test'],
  cookieDomain: 'zero.example.test',
  externalIntegration: {
    apiToken: 'fixed-integration-token',
    webhook: {
      enabled: true,
      url: 'https://crm.example.test/webhooks/zero-mail',
    },
  },
} as RuntimeConfig;

const serviceHeaders = {
  authorization: `Bearer ${config.externalIntegration.apiToken}`,
  'content-type': 'application/json',
};

const rawEmail = new TextEncoder().encode(
  [
    'From: Airline <airline@example.test>',
    'To: Traveler <traveler@example.test>',
    'Subject: Trip confirmation',
    'Message-ID: <trip-confirmation@example.test>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="zero-boundary"',
    '',
    '--zero-boundary',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'Your trip is confirmed.',
    '--zero-boundary',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'AQIDBA==',
    '--zero-boundary--',
    '',
  ].join('\r\n'),
);

const cookiePair = (response: Response): string =>
  response.headers.get('set-cookie')!.split(';')[0]!;

describe('managed external mail end-to-end flow', () => {
  it('binds, notifies, reads, launches, and password-signs into one ordinary user mailbox scope', () =>
    withMailTestDatabase(async ({ db }) => {
      const blobStore = new MemoryBlobStore();
      const mailCore = createMailCoreForEnvironment(db, {
        blobStore,
        cursorSigningKey: config.betterAuthSecret,
        notificationsEnabled: true,
      });
      const userWorkspace = createUserWorkspaceService({ db });
      configureUserWorkspaceService(userWorkspace);
      const auth = createAuth({
        db,
        config,
        mail: {} as never,
        userWorkspace,
        email: { send: async () => undefined },
      });
      const services = {
        auth,
        blobStore,
        config,
        database: { db },
        environment: {
          BETTER_AUTH_SECRET: config.betterAuthSecret,
          MAIL_WEBHOOK_ENABLED: 'true',
        },
        nango: {},
        taskQueue: {
          enqueueIngress: async () => undefined,
          enqueueOutbound: async () => undefined,
          notify: () => undefined,
        },
        userWorkspace,
      } as unknown as RuntimeServices;
      const connectionRepository = createPostgresConnectionRepository(db);
      const accountIds = new Map<string, MailAccountId>();
      const channel = createGmailPlugin({
        createExecutor: async () => {
          throw new Error('Gmail API execution is outside this integration boundary');
        },
        resolveIdentity: async () => ({
          email: 'traveler@example.test',
          name: 'Traveler',
          picture: '',
        }),
      });
      const connect = async (
        input: Parameters<typeof connectNangoMailbox>[0],
        runtimeServices: RuntimeServices,
      ) =>
        await connectNangoMailbox(input, runtimeServices, {
          assertNangoChannelAvailable: async () => 'google-mail',
          reserve: async () => {
            throw new Error('Unexpected pending binding');
          },
          bind: async (bindingInput) =>
            await bindNangoMailbox(bindingInput, {
              client: {
                getConnection: async (connectionId: string, providerConfigKey: string) => ({
                  connection_id: connectionId,
                  provider_config_key: providerConfigKey,
                  provider: 'google-mail',
                  metadata: null,
                  tags: {},
                  errors: [],
                  credentials: {
                    type: 'OAUTH2',
                    access_token: 'integration-access-token',
                    raw: {},
                  },
                  connection_config: {},
                }),
              } as never,
              getChannel: () => channel,
              isIntegrationAvailable: async () => true,
              repository: {
                findMailboxByNormalizedEmail: (userId, channelId, normalizedEmail) =>
                  connectionRepository.findMailboxByNormalizedEmail(
                    userId,
                    channelId,
                    normalizedEmail,
                  ),
                findByNangoReference: (integrationId, connectionId) =>
                  connectionRepository.findByNangoReference(integrationId, connectionId),
                updateExternalData: ({ connectionId, externalData }) =>
                  connectionRepository.updateAuthorizationExternalData(
                    bindingInput.userId,
                    connectionId,
                    externalData,
                  ),
                save: (binding) =>
                  connectionRepository.saveBinding({
                    userId: bindingInput.userId,
                    ...binding,
                  }),
              },
              encryptionKey: config.credentialEncryptionKey,
              now: () => new Date('2026-07-30T11:00:00.000Z'),
            }),
          provision: async (provisionInput) => {
            const existing = await db.query.mailAccount.findFirst({
              where: eq(mailAccount.connectionId, provisionInput.connectionId),
            });
            const account =
              existing ??
              (await mailCore.createAccount({
                userId: provisionInput.userId,
                connectionId: provisionInput.connectionId,
                timezone: 'UTC',
                storageQuotaBytes: null,
              }));
            accountIds.set(provisionInput.userId, account.id as MailAccountId);
            return account;
          },
        });

      const integration = createExternalIntegrationRouter(services, { connect });
      const autoRegisteredGrantResponse = await integration.request('/access-grants', {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ externalUserId: 'user_201' }),
      });
      expect(autoRegisteredGrantResponse.status).toBe(201);
      const autoRegisteredGrant = (await autoRegisteredGrantResponse.json()) as {
        launchCode: string;
      };
      const autoRegisteredLaunchResponse = await integration.request('/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ launchCode: autoRegisteredGrant.launchCode }),
      });
      expect(autoRegisteredLaunchResponse.status).toBe(303);
      const autoRegisteredUser = await db.query.user.findFirst({
        where: eq(user.username, 'user_201'),
      });
      expect(autoRegisteredUser).toMatchObject({
        role: 'user',
        mustChangePassword: true,
      });
      await expect(
        connectionRepository.listConnectionsWithAuthorization(autoRegisteredUser!.id),
      ).resolves.toEqual([]);
      await expect(
        auth.api.getSession({
          headers: new Headers({ cookie: cookiePair(autoRegisteredLaunchResponse) }),
        }),
      ).resolves.toMatchObject({
        user: { id: autoRegisteredUser!.id, username: 'user_201' },
        session: { authMethod: 'launch' },
      });

      const bind = async (externalUserId: string) =>
        await integration.request('/nango/connections/bind', {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({
            externalUserId,
            channelId: 'gmail',
            connectionId: 'connect-gmail-01',
          }),
        });

      const firstBind = await bind('user_200');
      expect(firstBind.status).toBe(200);
      const firstBinding = (await firstBind.json()) as { id: string };
      const repeatedBind = await bind('user_200');
      expect(repeatedBind.status).toBe(200);
      await expect(repeatedBind.json()).resolves.toEqual(firstBinding);

      const managedUser = await db.query.user.findFirst({
        where: eq(user.username, 'user_200'),
      });
      expect(managedUser).toMatchObject({
        role: 'user',
        mustChangePassword: true,
      });
      await expect(
        connectionRepository.findByNangoReference('google-mail', 'connect-gmail-01'),
      ).resolves.toMatchObject({
        connectionId: firstBinding.id,
        userId: managedUser!.id,
      });

      const conflictingBind = await bind('user_201');
      expect(conflictingBind.status).toBe(409);
      await expect(conflictingBind.json()).resolves.toEqual({
        error: 'NANGO_CONNECTION_ALREADY_BOUND',
      });

      const accountId = accountIds.get(managedUser!.id)!;
      const inbox = (await mailCore.listMailboxes({ accountId })).find(
        (mailbox) => mailbox.role === 'inbox',
      )!;
      const imported = await mailCore.importEmail({
        accountId,
        provider: 'gmail',
        remoteEmailId: 'remote-message-1',
        remoteThreadId: null,
        raw: rawEmail,
        mailboxIds: [inbox.id],
        keywords: [],
        receivedAt: new Date('2026-07-30T12:00:00.000Z'),
      });

      const notificationRepository = createPostgresMailNotificationRepository(db, {
        enabled: true,
      });
      const claimed = await notificationRepository.claim({
        now: new Date(Date.now() + 60_000),
        limit: 10,
        owner: 'integration-worker',
        leaseForMs: 30_000,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ messageId: imported.emailId, kind: 'received' });
      const deliveredPayloads: unknown[] = [];
      await deliverPendingEvent(claimed[0]!, {
        webhookUrl: config.externalIntegration.webhook.url!,
        fetch: vi.fn(async (_url, init) => {
          deliveredPayloads.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 204 });
        }),
        repository: notificationRepository,
        timeoutMs: 1_000,
        clock: { now: () => new Date() },
      });
      expect(deliveredPayloads).toEqual([
        {
          eventId: claimed[0]!.eventId,
          messageId: imported.emailId,
        },
      ]);

      const summaryResponse = await integration.request(
        `/mail/messages/${imported.emailId}/summary`,
        { headers: serviceHeaders },
      );
      expect(summaryResponse.status).toBe(200);
      await expect(summaryResponse.json()).resolves.toMatchObject({
        messageId: imported.emailId,
        mailAccountId: accountId,
        nangoConnectionId: 'connect-gmail-01',
        channelId: 'gmail',
        subject: 'Trip confirmation',
        attachmentCount: 1,
      });

      const contentResponse = await integration.request(
        `/mail/messages/${imported.emailId}/content`,
        { headers: serviceHeaders },
      );
      await expect(contentResponse.json()).resolves.toMatchObject({
        messageId: imported.emailId,
        textBody: 'Your trip is confirmed.',
      });
      const attachmentsResponse = await integration.request(
        `/mail/messages/${imported.emailId}/attachments`,
        { headers: serviceHeaders },
      );
      const attachments = (await attachmentsResponse.json()) as Array<{ attachmentId: string }>;
      expect(attachments).toHaveLength(1);
      const attachmentResponse = await integration.request(
        `/mail/attachments/${attachments[0]!.attachmentId}/content`,
        { headers: serviceHeaders },
      );
      expect(new Uint8Array(await attachmentResponse.arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );

      const grantResponse = await integration.request('/access-grants', {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ externalUserId: 'user_200' }),
      });
      expect(grantResponse.status).toBe(201);
      const { launchCode } = (await grantResponse.json()) as { launchCode: string };
      const launchResponse = await integration.request('/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ launchCode }),
      });
      expect(launchResponse.status).toBe(303);
      const launchCookie = cookiePair(launchResponse);
      const launchSession = await auth.api.getSession({
        headers: new Headers({ cookie: launchCookie }),
      });
      expect(launchSession).toMatchObject({
        user: { id: managedUser!.id, username: 'user_200', role: 'user' },
        session: { authMethod: 'launch' },
      });
      const repeatedLaunch = await integration.request('/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ launchCode }),
      });
      expect(repeatedLaunch.status).toBe(400);

      const openRuntime = async () => ({
        core: mailCore,
        db,
        cursorSigningKey: config.betterAuthSecret,
        listAllAccounts: async () => await db.select().from(mailAccount),
        outbound: {} as never,
        snooze: {} as never,
        close: async () => undefined,
      });
      const testRouter = router({
        account: createAccountRouter(openRuntime as never),
        settings: settingsRouter,
        user: userRouter,
      });
      const callWithCookie = async <T>(
        cookie: string,
        call: (caller: ReturnType<typeof testRouter.createCaller>) => Promise<T>,
      ): Promise<T> => {
        let value: T | undefined;
        let failure: unknown;
        const app = new Hono<HonoContext>().post('/', async (context) => {
          context.set('auth', auth);
          context.set('services', services);
          const currentSession = await auth.api.getSession({
            headers: context.req.raw.headers,
          });
          if (currentSession !== null) {
            context.set('sessionUser', currentSession.user);
            context.set('authSession', currentSession.session);
          }
          const caller = testRouter.createCaller({
            c: context,
            auth,
            services,
            sessionUser: currentSession?.user,
            authSession: currentSession?.session,
          });
          try {
            value = await call(caller);
          } catch (error) {
            failure = error;
          }
          return context.json({ ok: failure === undefined });
        });
        await app.request('/', {
          method: 'POST',
          headers: { cookie },
        });
        if (failure !== undefined) throw failure;
        return value!;
      };

      await expect(
        callWithCookie(launchCookie, (caller) => caller.account.list()),
      ).resolves.toMatchObject({
        accounts: [{ id: accountId }],
      });
      await expect(
        callWithCookie(launchCookie, (caller) => caller.settings.save({ language: 'zh' })),
      ).resolves.toEqual({ success: true });
      await expect(
        userWorkspace.forUser(managedUser!.id).findUserSettings(),
      ).resolves.toMatchObject({
        settings: { language: 'zh' },
      });

      const initialPasswordResponse = await auth.handler(
        new Request(`${config.publicBackendUrl}/api/auth/sign-in/username`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: config.publicAppUrl,
          },
          body: JSON.stringify({
            username: 'user_200',
            password: 'user_200',
          }),
        }),
      );
      expect(initialPasswordResponse.status).toBe(200);
      const initialPasswordCookie = cookiePair(initialPasswordResponse);
      const initialPasswordSession = await auth.api.getSession({
        headers: new Headers({ cookie: initialPasswordCookie }),
      });
      expect(initialPasswordSession).toMatchObject({
        user: { id: managedUser!.id, mustChangePassword: true },
        session: { authMethod: 'password' },
      });
      await expect(
        callWithCookie(initialPasswordCookie, (caller) => caller.account.list()),
      ).rejects.toMatchObject({ message: 'PASSWORD_CHANGE_REQUIRED' });

      await callWithCookie(initialPasswordCookie, (caller) =>
        caller.user.changePassword({
          currentPassword: 'user_200',
          newPassword: 'changed-password-200',
        }),
      );
      const changedPasswordResponse = await auth.handler(
        new Request(`${config.publicBackendUrl}/api/auth/sign-in/username`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: config.publicAppUrl,
          },
          body: JSON.stringify({
            username: 'user_200',
            password: 'changed-password-200',
          }),
        }),
      );
      expect(changedPasswordResponse.status).toBe(200);
      const changedPasswordCookie = cookiePair(changedPasswordResponse);
      const changedPasswordSession = await auth.api.getSession({
        headers: new Headers({ cookie: changedPasswordCookie }),
      });
      expect(changedPasswordSession).toMatchObject({
        user: { id: managedUser!.id, mustChangePassword: false },
        session: { authMethod: 'password' },
      });
      await expect(
        callWithCookie(changedPasswordCookie, (caller) => caller.account.list()),
      ).resolves.toMatchObject({
        accounts: [{ id: accountId }],
      });

      const otherUser = await db.query.user.findFirst({
        where: eq(user.username, 'user_201'),
      });
      expect(otherUser).toBeDefined();
      await expect(
        connectionRepository.listConnectionsWithAuthorization(otherUser!.id),
      ).resolves.toEqual([]);
      await expect(
        db.query.mailAccount.findFirst({
          where: and(eq(mailAccount.id, accountId), eq(mailAccount.userId, otherUser!.id)),
        }),
      ).resolves.toBeUndefined();

      const otherPasswordResponse = await auth.handler(
        new Request(`${config.publicBackendUrl}/api/auth/sign-in/username`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: config.publicAppUrl,
          },
          body: JSON.stringify({
            username: 'user_201',
            password: 'user_201',
          }),
        }),
      );
      expect(otherPasswordResponse.status).toBe(200);
      const otherPasswordCookie = cookiePair(otherPasswordResponse);
      await callWithCookie(otherPasswordCookie, (caller) =>
        caller.user.changePassword({
          currentPassword: 'user_201',
          newPassword: 'changed-password-201',
        }),
      );
      await expect(
        callWithCookie(otherPasswordCookie, (caller) => caller.account.list()),
      ).resolves.toEqual({ accounts: [] });
      await expect(
        callWithCookie(otherPasswordCookie, (caller) => caller.account.get({ accountId })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }));
});
