import type { MailAccountId } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';

import {
  ensureExternalIntegrationPrincipal,
  EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
} from '../../src/modules/external-integration/principal';
import { createPostgresConnectionRepository } from '../../src/modules/mail-accounts/postgres/connection-repository';
import { createPostgresExternalAccessRepository } from '../../src/modules/external-integration/postgres/repository';
import { createPostgresMailNotificationRepository } from '../../src/modules/mail-notifications/postgres/repository';
import { deliverPendingEvent } from '../../src/modules/mail-notifications/application/deliver-pending';
import { resolveExternalBrowserSession } from '../../src/modules/external-integration/session/resolve';
import { createChannelConfigRepository } from '../../src/integrations/core/channel-config-repository';
import { createExternalIntegrationRouter } from '../../src/modules/external-integration/http/router';
import { createNodeApplication } from '../../src/runtime/node/application';
import { createMailCoreForEnvironment } from '../../src/runtime/mail/core';
import type { RuntimeServices } from '../../src/runtime/node/services';
import { withMailTestDatabase } from '../helpers/mail-core/database';
import type { RuntimeConfig } from '../../src/runtime/node/config';
import { MemoryBlobStore } from '../../src/modules/mail';
import type { DB } from '../../src/db';

const SERVICE_TOKEN = 'fixed-integration-token';
const NANGO_CONNECTION_ID = 'nango-gmail-1';
const EMAIL_ADDRESS = 'traveler@example.test';

const createRuntimeConfig = (databaseUrl: string): RuntimeConfig => ({
  nodeEnv: 'local',
  host: '127.0.0.1',
  port: 8787,
  databaseUrl,
  mailBlobRoot: 'D:\\zero-test-blobs',
  shutdownGraceMs: 1_000,
  publicAppUrl: 'http://mail.zero.test:3000',
  publicBackendUrl: 'http://api.zero.test:8787',
  jwtSecret: 'integration-test-jwt-secret-value',
  betterAuthSecret: 'integration-test-better-auth-secret-value',
  betterAuthUrl: 'http://api.zero.test:8787',
  cookieDomain: 'zero.test',
  betterAuthTrustedOrigins: ['http://mail.zero.test:3000'],
  credentialEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
  nango: {
    gmailIntegrationKey: 'google-mail',
    outlookIntegrationKey: 'outlook',
    zohoMailIntegrationKey: 'zoho-mail',
    imapSmtpIntegrationKey: 'generic-email',
  },
  redis: {
    url: 'http://upstash-proxy:80',
    token: 'upstash-local-token',
  },
  admin: {
    autoProvision: false,
  },
  github: {},
  externalIntegration: {
    apiToken: SERVICE_TOKEN,
    webhook: {
      enabled: true,
      url: 'https://receiver.example.test/mail-events',
    },
  },
});

const createServices = (input: {
  db: DB;
  sql: RuntimeServices['database']['sql'];
  databaseUrl: string;
  blobStore: MemoryBlobStore;
}): RuntimeServices => {
  const config = createRuntimeConfig(input.databaseUrl);
  return {
    config,
    environment: {
      NODE_ENV: 'local',
      BETTER_AUTH_SECRET: config.betterAuthSecret,
    },
    database: {
      db: input.db,
      sql: input.sql,
      close: async () => undefined,
    },
    blobStore: input.blobStore,
    readiness: {
      snapshot: {
        database: true,
        blobStore: true,
        worker: true,
        scheduler: true,
        http: true,
      },
      mark: vi.fn(),
      isReady: () => true,
    },
    auth: {
      api: {
        getSession: vi.fn(async () => null),
      },
    },
    ensureAdmin: vi.fn(async () => undefined),
    webhooks: {
      gmail: vi.fn(async () => new Response(null, { status: 202 })),
      outlook: vi.fn(async () => new Response(null, { status: 202 })),
      zohoMail: vi.fn(async () => new Response(null, { status: 202 })),
    },
  } as unknown as RuntimeServices;
};

const serviceHeaders = {
  authorization: `Bearer ${SERVICE_TOKEN}`,
  'content-type': 'application/json',
};

const incomingEmail = new TextEncoder().encode(
  [
    `From: Customer <${EMAIL_ADDRESS}>`,
    'To: Support <support@example.test>',
    'Message-ID: <external-flow@example.test>',
    'Date: Wed, 29 Jul 2026 10:00:00 +0000',
    'Subject: Travel itinerary',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="zero-boundary"',
    '',
    '--zero-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Your updated itinerary is attached.',
    '--zero-boundary',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="itinerary.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'aXRpbmVyYXJ5',
    '--zero-boundary--',
    '',
  ].join('\r\n'),
);

describe('external mail integration flow', () => {
  it('binds, notifies, reads, launches, scopes, and rejects privileged access', async () => {
    await withMailTestDatabase(async ({ db, sql, databaseUrl }) => {
      const blobStore = new MemoryBlobStore();
      const services = createServices({ db, sql, databaseUrl, blobStore });
      const connectionRepository = createPostgresConnectionRepository(db, {
        newId: (() => {
          let nextId = 0;
          return () => `external-flow-${++nextId}`;
        })(),
      });
      const core = createMailCoreForEnvironment(db, {
        blobStore,
        cursorSigningKey: services.config.betterAuthSecret,
        notificationsEnabled: true,
      });
      let accountId: MailAccountId | null = null;

      const serviceApi = createExternalIntegrationRouter(services, {
        connect: async (input) => {
          const configured = await createChannelConfigRepository(db).get(input.channelId);
          if (configured?.authSource !== 'nango') {
            throw new Error('MAIL_CHANNEL_NOT_CONFIGURED_FOR_NANGO');
          }
          const connection = await connectionRepository.saveBinding({
            userId: input.userId,
            existingMailboxId: null,
            mailbox: {
              email: EMAIL_ADDRESS,
              normalizedEmail: EMAIL_ADDRESS,
              name: 'Traveler',
              picture: '',
              channelId: input.channelId,
              providerKey: 'gmail',
            },
            authorization: {
              authSource: 'nango',
              credentialType: 'oauth2',
              encryptedCredentialSnapshot: 'encrypted-test-credential',
              accessTokenExpiresAt: null,
              credentialFetchedAt: new Date('2026-07-29T09:00:00.000Z'),
              nangoConnectionId: input.connectionId,
              nangoProviderConfigKey: 'google-mail',
            },
          });
          const account = await core.createAccount({
            userId: input.userId,
            connectionId: connection.id,
            timezone: 'UTC',
            storageQuotaBytes: null,
          });
          accountId = account.id;
          return connection;
        },
      });

      await ensureExternalIntegrationPrincipal(db);
      await createChannelConfigRepository(db).save({
        channelId: 'gmail',
        authSource: 'nango',
        inboxWatchEnabled: true,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 5,
        providerConfig: {},
        updatedBy: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
      });

      const bindResponse = await serviceApi.request('/nango/connections/bind', {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          channelId: 'gmail',
          connectionId: NANGO_CONNECTION_ID,
        }),
      });
      expect(bindResponse.status).toBe(200);
      const binding = (await bindResponse.json()) as { id: string };
      expect(accountId).not.toBeNull();
      await expect(
        connectionRepository.findConnectionWithAuthorization(
          EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
          binding.id,
        ),
      ).resolves.toMatchObject({
        connection: {
          id: binding.id,
          channelId: 'gmail',
          email: EMAIL_ADDRESS,
        },
        authorization: {
          authSource: 'nango',
          nangoConnectionId: NANGO_CONNECTION_ID,
        },
      });

      const mailbox = (await core.listMailboxes({ accountId: accountId! })).find(
        ({ role }) => role === 'inbox',
      );
      expect(mailbox).toBeDefined();
      const imported = await core.importEmail({
        accountId: accountId!,
        provider: 'gmail',
        remoteEmailId: 'remote-external-flow',
        remoteThreadId: null,
        raw: incomingEmail,
        mailboxIds: [mailbox!.id],
        keywords: [],
        receivedAt: new Date('2026-07-29T10:00:00.000Z'),
      });

      const notificationRepository = createPostgresMailNotificationRepository(db, {
        enabled: true,
      });
      const deliveryTime = new Date(Date.now() + 1_000);
      const [notification] = await notificationRepository.claim({
        owner: 'external-flow-worker',
        now: deliveryTime,
        limit: 1,
        leaseForMs: 60_000,
      });
      expect(notification).toBeDefined();
      let webhookBody: unknown;
      await deliverPendingEvent(notification!, {
        webhookUrl: services.config.externalIntegration.webhook.url!,
        fetch: vi.fn(async (_input, init) => {
          webhookBody = JSON.parse(String(init?.body));
          return new Response(null, { status: 204 });
        }),
        repository: notificationRepository,
        clock: {
          now: () => deliveryTime,
        },
      });
      expect(webhookBody).toEqual({
        eventId: notification!.eventId,
        messageId: imported.emailId,
      });
      expect(Object.keys(webhookBody as Record<string, unknown>)).toEqual(['eventId', 'messageId']);

      const readJson = async (path: string): Promise<Record<string, unknown>> => {
        const response = await serviceApi.request(path, {
          headers: {
            authorization: `Bearer ${SERVICE_TOKEN}`,
          },
        });
        expect(response.status).toBe(200);
        return (await response.json()) as Record<string, unknown>;
      };
      const summary = await readJson(`/mail/messages/${imported.emailId}/summary`);
      expect(summary).toMatchObject({
        messageId: imported.emailId,
        nangoConnectionId: NANGO_CONNECTION_ID,
        subject: 'Travel itinerary',
        preview: 'Your updated itinerary is attached.',
        hasAttachment: true,
        attachmentCount: 1,
      });
      const content = await readJson(`/mail/messages/${imported.emailId}/content`);
      expect(content).toEqual({
        messageId: imported.emailId,
        textBody: 'Your updated itinerary is attached.',
        htmlBody: null,
      });
      const attachments = (await readJson(
        `/mail/messages/${imported.emailId}/attachments`,
      )) as unknown as Array<{
        attachmentId: string;
        filename: string;
      }>;
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({
        filename: 'itinerary.pdf',
      });
      const attachmentResponse = await serviceApi.request(
        `/mail/attachments/${attachments[0]!.attachmentId}/content`,
        {
          headers: {
            authorization: `Bearer ${SERVICE_TOKEN}`,
          },
        },
      );
      expect(attachmentResponse.status).toBe(200);
      expect(new TextDecoder().decode(await attachmentResponse.arrayBuffer())).toBe('itinerary');

      const grantResponse = await serviceApi.request('/access-grants', {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          allowedNangoConnectIds: [NANGO_CONNECTION_ID],
        }),
      });
      expect(grantResponse.status).toBe(201);
      const grant = (await grantResponse.json()) as { launchCode: string };
      expect(Object.keys(grant)).toEqual(['launchCode']);

      const launch = async () =>
        await serviceApi.request('/launch', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            launchCode: grant.launchCode,
          }).toString(),
        });
      const launchResponse = await launch();
      expect(launchResponse.status).toBe(303);
      expect(launchResponse.headers.get('location')).toBe('http://mail.zero.test:3000/mail/inbox');
      const browserCookie = launchResponse.headers.get('set-cookie')?.split(';', 1)[0];
      expect(browserCookie).toMatch(/^zero-external-session=.+/u);
      expect((await launch()).status).toBe(400);

      const accessRepository = createPostgresExternalAccessRepository(db);
      const browserApp = createNodeApplication(services, {
        resolveExternalSession: async (sessionToken) =>
          await resolveExternalBrowserSession(sessionToken, {
            repository: accessRepository,
            clock: { now: () => new Date() },
          }),
      });
      const getDefaultResponse = await browserApp.request(
        `/api/trpc/connections.getDefault?input=${encodeURIComponent(
          JSON.stringify({ json: null }),
        )}`,
        {
          headers: {
            cookie: browserCookie!,
          },
        },
      );
      expect(getDefaultResponse.status).toBe(200);
      const getDefaultBody = (await getDefaultResponse.json()) as {
        result: {
          data: {
            json: Record<string, unknown>;
          };
        };
      };
      expect(getDefaultBody.result.data.json).toMatchObject({
        id: binding.id,
        email: EMAIL_ADDRESS,
        channelId: 'gmail',
      });
      const settingsResponse = await (async () => {
        const errorLogger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
          return await browserApp.request('/api/trpc/settings.save', {
            method: 'POST',
            headers: {
              cookie: browserCookie!,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ json: {} }),
          });
        } finally {
          errorLogger.mockRestore();
        }
      })();
      expect(settingsResponse.status).toBe(401);
      await expect(settingsResponse.json()).resolves.toMatchObject({
        error: {
          json: {
            data: {
              code: 'UNAUTHORIZED',
            },
          },
        },
      });

      const privilegedBind = await browserApp.request('/api/integrations/nango/connections/bind', {
        method: 'POST',
        headers: {
          cookie: browserCookie!,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channelId: 'gmail',
          connectionId: 'forbidden-connection',
        }),
      });
      expect(privilegedBind.status).toBe(401);
    });
  });
});
