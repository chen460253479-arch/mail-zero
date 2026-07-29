import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  connect: vi.fn(),
  createDrizzle: vi.fn(),
}));

vi.mock('postgres', () => ({
  default: dependencies.connect,
}));

vi.mock('../../../../src/db', () => ({
  createDrizzle: dependencies.createDrizzle,
}));

import { createRuntimeDatabase } from '../../../../src/runtime/node/database';

describe('createRuntimeDatabase', () => {
  beforeEach(() => {
    dependencies.connect.mockReset();
    dependencies.createDrizzle.mockReset();
  });

  it('creates one bounded SQL pool and exposes the Drizzle database over it', () => {
    const sql = { end: vi.fn() };
    const db = { query: { user: {} } };
    dependencies.connect.mockReturnValue(sql);
    dependencies.createDrizzle.mockReturnValue(db);

    const runtime = createRuntimeDatabase('postgresql://postgres:postgres@db:5432/zero', {
      max: 7,
    });

    expect(runtime.sql).toBe(sql);
    expect(runtime.db).toBe(db);
    expect(dependencies.connect).toHaveBeenCalledOnce();
    expect(dependencies.connect).toHaveBeenCalledWith(
      'postgresql://postgres:postgres@db:5432/zero',
      {
        max: 7,
      },
    );
    expect(dependencies.createDrizzle).toHaveBeenCalledOnce();
    expect(dependencies.createDrizzle).toHaveBeenCalledWith(sql);
  });

  it('closes the shared SQL pool only once', async () => {
    const end = vi.fn().mockResolvedValue(undefined);
    dependencies.connect.mockReturnValue({ end });
    dependencies.createDrizzle.mockReturnValue({});
    const runtime = createRuntimeDatabase('postgresql://postgres:postgres@db:5432/zero');

    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();

    expect(end).toHaveBeenCalledOnce();
  });
});
