import { describe, expect, it } from 'vitest';

import {
  createChannelConfigRepository,
  type ChannelConfigRecord,
} from '../../../../src/integrations/core/channel-config-repository';
import type { DB } from '../../../../src/db';

const now = new Date('2026-07-28T08:00:00.000Z');

const createStatefulDatabase = () => {
  let record: ChannelConfigRecord | null = null;

  const db = {
    query: {
      channelConfig: {
        findFirst: async () => record,
      },
    },
    insert: () => ({
      values: (value: ChannelConfigRecord) => ({
        onConflictDoUpdate: ({ set }: { set: Partial<ChannelConfigRecord> }) => ({
          returning: async () => {
            record = record === null ? value : { ...record, ...set };
            return [record];
          },
        }),
      }),
    }),
  } as unknown as DB;

  return db;
};

describe('channel configuration repository', () => {
  it('upserts one global policy for a channel', async () => {
    const repository = createChannelConfigRepository(createStatefulDatabase(), {
      now: () => now,
      createId: () => 'gmail-channel-config',
    });

    await repository.save({
      channelId: 'gmail',
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
    });
    await repository.save({
      channelId: 'gmail',
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 30,
      providerConfig: {},
      updatedBy: 'admin-2',
    });

    expect(await repository.get('gmail')).toEqual({
      id: 'gmail-channel-config',
      channelId: 'gmail',
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 30,
      providerConfig: {},
      updatedBy: 'admin-2',
      createdAt: now,
      updatedAt: now,
    });
  });
});
