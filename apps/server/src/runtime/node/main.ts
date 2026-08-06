import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';

import {
  createRuntimeServices,
  type CreateRuntimeServicesInput,
  type RuntimeServices,
} from './services';
import { parseRuntimeConfig, type RuntimeConfig, type RuntimeEnvironmentSource } from './config';
import { createAwsS3ObjectClient, S3BlobStore } from '../../modules/mail';
import { createRuntimeDatabase, type RuntimeDatabase } from './database';
import { createLogger } from '../../infrastructure/logging/logger';
import { createNodeApplication } from './application';
import type { BlobStore } from '@zero/mail-core';

type BlobStoreLifecycle = BlobStore & { initialize(): Promise<void>; close(): void };

export type NodeHttpListener = {
  close(): Promise<void>;
};

export type NodeServerLifecycleDependencies = {
  parseConfig(source: RuntimeEnvironmentSource): RuntimeConfig;
  createDatabase(config: RuntimeConfig): RuntimeDatabase | Promise<RuntimeDatabase>;
  createBlobStore(config: RuntimeConfig): BlobStoreLifecycle;
  createServices(input: CreateRuntimeServicesInput): RuntimeServices | Promise<RuntimeServices>;
  createApplication(services: RuntimeServices): ReturnType<typeof createNodeApplication>;
  listen(
    application: ReturnType<typeof createNodeApplication>,
    config: RuntimeConfig,
  ): Promise<NodeHttpListener>;
  registerSignal(signal: NodeJS.Signals, handler: () => void): () => void;
};

const listen = async (
  application: ReturnType<typeof createNodeApplication>,
  config: RuntimeConfig,
): Promise<NodeHttpListener> =>
  await new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: application.fetch,
        hostname: config.host,
        port: config.port,
      },
      () => {
        server.off('error', reject);
        resolve({
          close: async () =>
            await new Promise<void>((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) closeReject(error);
                else closeResolve();
              });
            }),
        });
      },
    );
    server.once('error', reject);
  });

export const createRuntimeBlobStore = (config: RuntimeConfig): S3BlobStore => {
  const storage = config.mailBlobStore;
  return new S3BlobStore({
    client: createAwsS3ObjectClient({
      region: storage.region,
      endpoint: storage.endpoint ?? null,
      forcePathStyle: storage.forcePathStyle,
      accessKeyId: storage.accessKeyId ?? null,
      secretAccessKey: storage.secretAccessKey ?? null,
      bucket: storage.bucket,
    }),
    prefix: storage.prefix,
  });
};

const defaultDependencies: NodeServerLifecycleDependencies = {
  parseConfig: parseRuntimeConfig,
  async createDatabase(config) {
    const database = createRuntimeDatabase(config.databaseUrl);
    try {
      await database.sql`select 1`;
      return database;
    } catch (error) {
      await database.close().catch(() => undefined);
      throw error;
    }
  },
  createBlobStore: createRuntimeBlobStore,
  createServices: createRuntimeServices,
  createApplication: createNodeApplication,
  listen,
  registerSignal(signal, handler) {
    process.once(signal, handler);
    return () => process.off(signal, handler);
  },
};

const markReady = (
  services: RuntimeServices,
  component: keyof RuntimeServices['readiness']['snapshot'],
  ready = true,
): void => {
  if (typeof services.readiness.mark === 'function') {
    services.readiness.mark(component, ready);
  } else {
    services.readiness.snapshot[component] = ready;
  }
};

export const startZeroServer = async (
  source: RuntimeEnvironmentSource = process.env,
  dependencies: NodeServerLifecycleDependencies = defaultDependencies,
): Promise<{ close(): Promise<void> }> => {
  const config = dependencies.parseConfig(source);
  const logger = createLogger({
    level: config.logLevel ?? (config.nodeEnv === 'production' ? 'info' : 'debug'),
  });
  logger.info('server.starting', {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    logLevel: logger.level,
  });
  let database: RuntimeDatabase | undefined;
  let blobStore: BlobStoreLifecycle | undefined;
  let services: RuntimeServices | undefined;
  let listener: NodeHttpListener | undefined;
  let workerStarted = false;
  let notificationWorkerStarted = false;
  let schedulerStarted = false;
  let closePromise: Promise<void> | undefined;
  const disposeSignals: Array<() => void> = [];

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      logger.info('server.stopping');
      disposeSignals.splice(0).forEach((dispose) => dispose());
      if (listener) await listener.close();
      if (schedulerStarted && services) await services.scheduler.stop();
      if (notificationWorkerStarted && services) {
        await services.notificationWorker.stop();
      }
      if (workerStarted && services) await services.taskWorker.stop();
      if (services) await services.externalClients.close();
      blobStore?.close();
      if (database) await database.close();
      logger.info('server.stopped');
    })();
    return closePromise;
  };

  try {
    database = await dependencies.createDatabase(config);
    blobStore = dependencies.createBlobStore(config);
    await blobStore.initialize();
    services = await dependencies.createServices({ config, database, blobStore, logger });
    markReady(services, 'database');
    markReady(services, 'blobStore');

    try {
      await services.integrationHealth.initialize();
    } catch (error) {
      logger.warn('integration.nango.validation_failed', { error });
    }

    services.taskWorker.start();
    workerStarted = true;
    markReady(services, 'worker');
    services.notificationWorker.start();
    notificationWorkerStarted = true;
    services.scheduler.start();
    schedulerStarted = true;
    markReady(services, 'scheduler');

    const application = dependencies.createApplication(services);
    listener = await dependencies.listen(application, config);
    markReady(services, 'http');
    logger.info('server.started', { host: config.host, port: config.port });

    const handleSignal = () => {
      void close().catch((error) => {
        logger.error('server.shutdown_failed', { error });
        process.exitCode = 1;
      });
    };
    disposeSignals.push(
      dependencies.registerSignal('SIGTERM', handleSignal),
      dependencies.registerSignal('SIGINT', handleSignal),
    );

    return { close };
  } catch (error) {
    logger.error('server.startup_failed', { error });
    await close().catch((closeError) => {
      logger.error('server.startup_cleanup_failed', { error: closeError });
    });
    throw error;
  }
};

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  startZeroServer().catch((error) => {
    createLogger({ level: 'error' }).error('server.failed_to_start', { error });
    process.exitCode = 1;
  });
}
