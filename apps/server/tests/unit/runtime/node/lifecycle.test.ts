import { describe, expect, it, vi } from 'vitest';

import {
  createRuntimeBlobStore,
  startZeroServer,
  type NodeServerLifecycleDependencies,
} from '../../../../src/runtime/node/main';
import { S3BlobStore } from '../../../../src/modules/mail';

const environment = {
  DATABASE_URL: 'postgresql://localhost/zero',
} as NodeJS.ProcessEnv;

const createHarness = () => {
  const events: string[] = [];
  const database = {
    db: {},
    sql: vi.fn(),
    close: vi.fn(async () => {
      events.push('database close');
    }),
  };
  const blobStore = {
    initialize: vi.fn(async () => {
      events.push('blob');
    }),
    close: vi.fn(() => {
      events.push('blob close');
    }),
  };
  const taskWorker = {
    start: vi.fn(() => {
      events.push('worker');
    }),
    stop: vi.fn(async () => {
      events.push('worker stop');
    }),
    notify: vi.fn(),
  };
  const notificationWorker = {
    start: vi.fn(() => {
      events.push('notification worker');
    }),
    stop: vi.fn(async () => {
      events.push('notification worker stop');
    }),
    notify: vi.fn(),
  };
  const scheduler = {
    start: vi.fn(() => {
      events.push('scheduler');
    }),
    stop: vi.fn(async () => {
      events.push('scheduler stop');
    }),
    tick: vi.fn(),
  };
  const services = {
    taskWorker,
    notificationWorker,
    scheduler,
    integrationHealth: {
      initialize: vi.fn(async () => {
        events.push('Nango validation');
      }),
    },
    externalClients: {
      close: vi.fn(async () => {
        events.push('external clients close');
      }),
    },
    readiness: {
      snapshot: {
        database: false,
        blobStore: false,
        worker: false,
        scheduler: false,
        http: false,
      },
    },
  };
  const listener = {
    close: vi.fn(async () => {
      events.push('HTTP close');
    }),
  };
  const dependencies = {
    parseConfig: vi.fn(() => {
      events.push('config');
      return { shutdownGraceMs: 30_000, logLevel: 'silent' } as never;
    }),
    createDatabase: vi.fn(() => {
      events.push('database');
      return database as never;
    }),
    createBlobStore: vi.fn(() => blobStore as never),
    createServices: vi.fn(() => services as never),
    createApplication: vi.fn(() => ({ fetch: vi.fn() }) as never),
    listen: vi.fn(async () => {
      events.push('HTTP');
      return listener;
    }),
    registerSignal: vi.fn(() => () => undefined),
  } satisfies NodeServerLifecycleDependencies;

  return { blobStore, database, dependencies, events, listener, services };
};

describe('native Node server lifecycle', () => {
  it('constructs the production runtime with the S3 BlobStore only', () => {
    expect(
      createRuntimeBlobStore({
        mailBlobStore: {
          type: 's3',
          endpoint: 'https://objects.example.test',
          region: 'us-east-1',
          bucket: 'zero-mail',
          prefix: 'mail',
          forcePathStyle: true,
          accessKeyId: 'external-s3-access-key',
          secretAccessKey: 'external-s3-secret-key',
        },
      } as never),
    ).toBeInstanceOf(S3BlobStore);
  });

  it('starts core services in readiness order and shuts down in reverse ownership order', async () => {
    const harness = createHarness();

    const server = await startZeroServer(environment, harness.dependencies);
    expect(harness.events).toEqual([
      'config',
      'database',
      'blob',
      'Nango validation',
      'worker',
      'notification worker',
      'scheduler',
      'HTTP',
    ]);

    await server.close();
    expect(harness.events.slice(8)).toEqual([
      'HTTP close',
      'scheduler stop',
      'notification worker stop',
      'worker stop',
      'external clients close',
      'blob close',
      'database close',
    ]);
    await server.close();
    expect(harness.listener.close).toHaveBeenCalledOnce();
  });

  it('closes the database when blob initialization fails', async () => {
    const harness = createHarness();
    harness.blobStore.initialize.mockRejectedValueOnce(new Error('blob unavailable'));

    await expect(startZeroServer(environment, harness.dependencies)).rejects.toThrow(
      'blob unavailable',
    );
    expect(harness.blobStore.close).toHaveBeenCalledOnce();
    expect(harness.database.close).toHaveBeenCalledOnce();
    expect(harness.dependencies.listen).not.toHaveBeenCalled();
  });

  it('does not fail startup when Nango records an unavailable state', async () => {
    const harness = createHarness();
    harness.services.integrationHealth.initialize.mockResolvedValueOnce(undefined);

    const server = await startZeroServer(environment, harness.dependencies);

    expect(harness.dependencies.listen).toHaveBeenCalledOnce();
    await server.close();
  });
});
