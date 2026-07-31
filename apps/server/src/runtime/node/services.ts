import { Resend } from 'resend';
import { ulid } from 'ulid';

import {
  createDisabledMailNotificationWorker,
  createMailNotificationWorker,
  createPostgresMailNotificationRepository,
  deliverPendingEvent,
  type MailNotificationWorker,
} from '../../modules/mail-notifications';
import {
  createMailScheduler,
  createMailTaskWorker,
  createPostgresMailTaskRepository,
  type MailScheduler,
  type MailTaskRepository,
  type MailTaskWorker,
} from '../../modules/mail-tasks';
import {
  createNangoIntegrationService,
  type NangoIntegrationService,
  type NangoRuntimeStatus,
} from '../../integrations/nango/service';
import {
  createNangoChannelIntegrationService,
  type NangoChannelIntegrationService,
} from '../../integrations/nango/channels';
import {
  createConfiguredAdminProvisioner,
  provisionAdmin,
  type ProvisionAdminResult,
} from '../../lib/admin-provisioning';
import {
  enqueueDueMailIngressWork,
  runMailIngressCommand,
  type MailInboundRuntimeResources,
} from '../mail/inbound';
import {
  createUserWorkspaceService,
  type UserWorkspaceService,
} from '../../modules/user-workspace/service';
import { enqueueDueMailOutboundWork, runMailOutboundCommand } from '../mail/outbound';
import { createMailTaskQueuePort, type MailTaskQueuePort } from '../mail/task-queue';
import { wakeDueMailSnoozes } from '../../modules/mail-snooze/runtime/environment';
import { handleOutlookWebhookForEnvironment } from '../mail/outlook-inbound';
import type { AdminCredentials } from '../../lib/admin-provisioning-policy';
import { handleZohoMailWebhookForEnvironment } from '../mail/zoho-inbound';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { handleGmailWebhookForEnvironment } from '../mail/gmail-inbound';
import { configureUserWorkspaceService } from '../../lib/server-utils';
import { createAuth, type Auth } from '../../lib/auth';
import type { RuntimeDatabase } from './database';
import type { BlobStore } from '@zero/mail-core';
import type { RuntimeConfig } from './config';
import type { ZeroEnv } from '../../env';

export type RuntimeReadinessSnapshot = {
  database: boolean;
  blobStore: boolean;
  worker: boolean;
  scheduler: boolean;
  http: boolean;
};

export type RuntimeReadiness = {
  snapshot: RuntimeReadinessSnapshot;
  mark(component: keyof RuntimeReadinessSnapshot, ready?: boolean): void;
  isReady(): boolean;
};

export const createRuntimeReadiness = (): RuntimeReadiness => {
  const snapshot: RuntimeReadinessSnapshot = {
    database: false,
    blobStore: false,
    worker: false,
    scheduler: false,
    http: false,
  };
  return {
    snapshot,
    mark(component, ready = true) {
      snapshot[component] = ready;
    },
    isReady() {
      return Object.values(snapshot).every(Boolean);
    },
  };
};

export type IntegrationHealth = {
  initialize(): Promise<unknown>;
  getStatus(): NangoRuntimeStatus;
};

export type RuntimeWebhookHandlers = {
  gmail(request: Request): Promise<Response>;
  outlook(request: Request): Promise<Response>;
  zohoMail(request: Request, endpointToken: string): Promise<Response>;
};

export type RuntimeServices = {
  config: RuntimeConfig;
  environment: ZeroEnv;
  database: RuntimeDatabase;
  blobStore: BlobStore;
  taskRepository: MailTaskRepository;
  taskQueue: MailTaskQueuePort;
  taskWorker: MailTaskWorker;
  notificationWorker: MailNotificationWorker;
  scheduler: MailScheduler;
  userWorkspace: UserWorkspaceService;
  integrationHealth: IntegrationHealth;
  nango: NangoIntegrationService;
  nangoChannels: NangoChannelIntegrationService;
  readiness: RuntimeReadiness;
  auth: Auth;
  ensureAdmin(): Promise<unknown>;
  provisionAdmin(credentials: AdminCredentials): Promise<ProvisionAdminResult>;
  webhooks: RuntimeWebhookHandlers;
  externalClients: { close(): Promise<void> };
};

export type CreateRuntimeServicesInput = {
  config: RuntimeConfig;
  database: RuntimeDatabase;
  blobStore: BlobStore;
};

const MAIL_NOTIFICATION_LEASE_FOR_MS = 5 * 60_000;
const MAIL_NOTIFICATION_MAX_DELIVERY_TIMEOUT_MS = 15_000;
const MAIL_NOTIFICATION_SHUTDOWN_BUFFER_MS = 250;

const createCompatibilityEnvironment = (config: RuntimeConfig): ZeroEnv =>
  ({
    NODE_ENV: config.nodeEnv,
    JWT_SECRET: config.jwtSecret,
    BASE_URL: config.baseUrl ?? config.publicBackendUrl,
    VITE_PUBLIC_APP_URL: config.publicAppUrl,
    VITE_PUBLIC_BACKEND_URL: config.publicBackendUrl,
    DATABASE_URL: config.databaseUrl,
    CREDENTIAL_ENCRYPTION_KEY: config.credentialEncryptionKey,
    NANGO_BASE_URL: config.nango.baseUrl,
    NANGO_SECRET_KEY: config.nango.secretKey,
    NANGO_GMAIL_INTEGRATION_KEY: config.nango.gmailIntegrationKey,
    NANGO_OUTLOOK_INTEGRATION_KEY: config.nango.outlookIntegrationKey,
    NANGO_ZOHO_MAIL_INTEGRATION_KEY: config.nango.zohoMailIntegrationKey,
    NANGO_IMAP_SMTP_INTEGRATION_KEY: config.nango.imapSmtpIntegrationKey,
    MAIL_PROTOCOL_ALLOWED_HOSTS: config.protocolAllowedHosts,
    INTEGRATION_API_TOKEN: config.externalIntegration.apiToken,
    MAIL_WEBHOOK_ENABLED: config.externalIntegration.webhook.enabled ? 'true' : 'false',
    MAIL_WEBHOOK_URL: config.externalIntegration.webhook.url,
    BETTER_AUTH_SECRET: config.betterAuthSecret,
    BETTER_AUTH_URL: config.betterAuthUrl,
    RESEND_API_KEY: config.resendApiKey ?? '',
    COOKIE_DOMAIN: config.cookieDomain,
    BETTER_AUTH_TRUSTED_ORIGINS: config.betterAuthTrustedOrigins.join(','),
    ZERO_ADMIN_AUTO_PROVISION: config.admin.autoProvision ? 'true' : 'false',
    ZERO_ADMIN_NAME: config.admin.name,
    ZERO_ADMIN_EMAIL: config.admin.email,
    ZERO_ADMIN_PASSWORD: config.admin.password,
    ZERO_ADMIN_BOOTSTRAP_SECRET: config.admin.bootstrapSecret,
    GITHUB_CLIENT_ID: config.github.clientId ?? '',
    GITHUB_CLIENT_SECRET: config.github.clientSecret ?? '',
    REDIS_URL: config.redis.url,
    REDIS_TOKEN: config.redis.token,
  }) as ZeroEnv;

const createEmailSender = (config: RuntimeConfig) => {
  const client = config.resendApiKey ? new Resend(config.resendApiKey) : null;
  return {
    async send(input: { from: string; to: string; subject: string; html: string }) {
      if (client) return await client.emails.send(input);
      console.info('[EMAIL_DISABLED]', { to: input.to, subject: input.subject });
      return { data: null, error: null };
    },
  };
};

export const createRuntimeServices = async ({
  config,
  database,
  blobStore,
}: CreateRuntimeServicesInput): Promise<RuntimeServices> => {
  const environment = createCompatibilityEnvironment(config);
  const readiness = createRuntimeReadiness();
  const userWorkspace = createUserWorkspaceService({ db: database.db });
  configureUserWorkspaceService(userWorkspace);

  const nango = createNangoIntegrationService({
    baseUrl: config.nango.baseUrl,
    secretKey: config.nango.secretKey,
    fetch,
    now: () => new Date(),
  });
  const taskRepository = createPostgresMailTaskRepository(database.db, {
    nextId: () => ulid(),
  });
  const taskWorkerReference: { current?: MailTaskWorker } = {};
  const taskQueue = createMailTaskQueuePort(taskRepository, () =>
    taskWorkerReference.current?.notify(),
  );
  const mailResources: MailInboundRuntimeResources = {
    environment,
    nango,
    blobStore,
    taskQueue,
  };
  const taskWorker = createMailTaskWorker({
    repository: taskRepository,
    processIngress: async (command) =>
      await runMailIngressCommand(database.db, mailResources, command),
    processOutbound: async (command) =>
      await runMailOutboundCommand(database.db, mailResources, command),
    concurrency: 4,
    pollIntervalMs: 1_000,
    leaseForMs: 5 * 60_000,
    clock: { now: () => new Date() },
    newOwner: () => crypto.randomUUID(),
  });
  taskWorkerReference.current = taskWorker;
  const notificationRepository = createPostgresMailNotificationRepository(database.db, {
    enabled: config.externalIntegration.webhook.enabled,
  });
  const webhookUrl = config.externalIntegration.webhook.url;
  const notificationDeliveryTimeoutMs = Math.min(
    MAIL_NOTIFICATION_MAX_DELIVERY_TIMEOUT_MS,
    MAIL_NOTIFICATION_LEASE_FOR_MS - 1,
    Math.max(1, config.shutdownGraceMs - MAIL_NOTIFICATION_SHUTDOWN_BUFFER_MS),
  );
  const notificationWorker =
    config.externalIntegration.webhook.enabled && webhookUrl !== undefined
      ? createMailNotificationWorker({
          repository: notificationRepository,
          deliver: async (event, signal) =>
            await deliverPendingEvent(event, {
              webhookUrl,
              fetch,
              repository: notificationRepository,
              signal,
              timeoutMs: notificationDeliveryTimeoutMs,
              clock: { now: () => new Date() },
            }),
          concurrency: 2,
          pollIntervalMs: 1_000,
          leaseForMs: MAIL_NOTIFICATION_LEASE_FOR_MS,
          clock: { now: () => new Date() },
          newOwner: () => crypto.randomUUID(),
        })
      : createDisabledMailNotificationWorker();
  const scheduler = createMailScheduler({
    repository: taskRepository,
    enqueueDueIngress: async () => await enqueueDueMailIngressWork(database.db, mailResources),
    enqueueDueOutbound: async () => await enqueueDueMailOutboundWork(database.db, mailResources),
    wakeDueSnoozes: async () =>
      await wakeDueMailSnoozes(database.db, {
        blobStore,
        cursorSigningKey: config.betterAuthSecret,
      }),
    intervalMs: 60_000,
    expiredRecoveryLimit: 100,
    clock: { now: () => new Date() },
  });

  const nangoChannels = createNangoChannelIntegrationService({
    environment,
    nango,
    getChannel: (channelId) => defaultMailChannelRegistry.get(channelId),
    now: () => new Date(),
  });
  const integrationHealth: IntegrationHealth = {
    async initialize() {
      await nangoChannels.initialize();
      return nango.getStatus();
    },
    getStatus: () => nango.getStatus(),
  };

  const email = createEmailSender(config);
  const auth = createAuth({
    db: database.db,
    config,
    mail: mailResources,
    userWorkspace,
    email,
  });
  const adminDependencies = { db: database.db, userWorkspace };
  const ensureAdmin = createConfiguredAdminProvisioner(environment, adminDependencies);

  return {
    config,
    environment,
    database,
    blobStore,
    taskRepository,
    taskQueue,
    taskWorker,
    notificationWorker,
    scheduler,
    userWorkspace,
    integrationHealth,
    nango,
    nangoChannels,
    readiness,
    auth,
    ensureAdmin,
    provisionAdmin: async (credentials) => await provisionAdmin(credentials, adminDependencies),
    webhooks: {
      gmail: async (request) =>
        await handleGmailWebhookForEnvironment(database.db, mailResources, request),
      outlook: async (request) =>
        await handleOutlookWebhookForEnvironment(database.db, mailResources, request),
      zohoMail: async (request, endpointToken) =>
        await handleZohoMailWebhookForEnvironment(
          database.db,
          mailResources,
          request,
          endpointToken,
        ),
    },
    externalClients: {
      close: async () => undefined,
    },
  };
};
