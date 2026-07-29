import { describe, expect, it, vi } from 'vitest';

import {
  startZeroServer,
  type NodeServerLifecycleDependencies,
} from '../../../../src/runtime/node/main';

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
      return { shutdownGraceMs: 30_000 } as never;
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
  it('starts core services in readiness order and shuts down in reverse ownership order', async () => {
    const harness = createHarness();

    const server = await startZeroServer(environment, harness.dependencies);
    expect(harness.events).toEqual([
      'config',
      'database',
      'blob',
      'Nango validation',
      'worker',
      'scheduler',
      'HTTP',
    ]);

    await server.close();
    expect(harness.events.slice(7)).toEqual([
      'HTTP close',
      'scheduler stop',
      'worker stop',
      'external clients close',
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
