import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';

import {
  createRuntimeServices,
  type CreateRuntimeServicesInput,
  type RuntimeServices,
} from './services';
import { parseRuntimeConfig, type RuntimeConfig, type RuntimeEnvironmentSource } from './config';
import { createRuntimeDatabase, type RuntimeDatabase } from './database';
import { createNodeApplication } from './application';
import { LocalBlobStore } from '../../modules/mail';

type BlobStoreLifecycle = LocalBlobStore & { initialize(): Promise<void> };

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
  createBlobStore: (config) => new LocalBlobStore(config.mailBlobRoot),
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
  let database: RuntimeDatabase | undefined;
  let services: RuntimeServices | undefined;
  let listener: NodeHttpListener | undefined;
  let workerStarted = false;
  let schedulerStarted = false;
  let closePromise: Promise<void> | undefined;
  const disposeSignals: Array<() => void> = [];

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      disposeSignals.splice(0).forEach((dispose) => dispose());
      if (listener) await listener.close();
      if (schedulerStarted && services) await services.scheduler.stop();
      if (workerStarted && services) await services.taskWorker.stop();
      if (services) await services.externalClients.close();
      if (database) await database.close();
    })();
    return closePromise;
  };

  try {
    database = await dependencies.createDatabase(config);
    const blobStore = dependencies.createBlobStore(config);
    await blobStore.initialize();
    services = await dependencies.createServices({ config, database, blobStore });
    markReady(services, 'database');
    markReady(services, 'blobStore');

    try {
      await services.integrationHealth.initialize();
    } catch (error) {
      console.error('Nango runtime validation failed', error);
    }

    services.taskWorker.start();
    workerStarted = true;
    markReady(services, 'worker');
    services.scheduler.start();
    schedulerStarted = true;
    markReady(services, 'scheduler');

    const application = dependencies.createApplication(services);
    listener = await dependencies.listen(application, config);
    markReady(services, 'http');

    const handleSignal = () => {
      void close().catch((error) => {
        console.error('Zero Server shutdown failed', error);
        process.exitCode = 1;
      });
    };
    disposeSignals.push(
      dependencies.registerSignal('SIGTERM', handleSignal),
      dependencies.registerSignal('SIGINT', handleSignal),
    );

    return { close };
  } catch (error) {
    await close().catch((closeError) => {
      console.error('Zero Server startup cleanup failed', closeError);
    });
    throw error;
  }
};

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  startZeroServer().catch((error) => {
    console.error('Zero Server failed to start', error);
    process.exitCode = 1;
  });
}
