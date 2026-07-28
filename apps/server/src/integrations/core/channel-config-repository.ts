import { eq } from 'drizzle-orm';

import type { MailChannelId } from '../../mail-channel/contracts';
import { channelConfig } from '../../db/schema';
import type { DB } from '../../db';

export type ChannelConfigRecord = typeof channelConfig.$inferSelect;

export type SaveChannelConfigInput = Pick<
  ChannelConfigRecord,
  | 'channelId'
  | 'authSource'
  | 'inboxWatchEnabled'
  | 'scheduledSyncEnabled'
  | 'syncIntervalMinutes'
  | 'providerConfig'
  | 'updatedBy'
>;

export interface ChannelConfigRepository {
  get(channelId: MailChannelId): Promise<ChannelConfigRecord | null>;
  save(input: SaveChannelConfigInput): Promise<ChannelConfigRecord>;
}

type ChannelConfigRepositoryDependencies = {
  now(): Date;
  createId(): string;
};

const defaultDependencies: ChannelConfigRepositoryDependencies = {
  now: () => new Date(),
  createId: () => crypto.randomUUID(),
};

export const createChannelConfigRepository = (
  db: DB,
  dependencies: ChannelConfigRepositoryDependencies = defaultDependencies,
): ChannelConfigRepository => ({
  get: async (channelId) =>
    (await db.query.channelConfig.findFirst({
      where: eq(channelConfig.channelId, channelId),
    })) ?? null,

  save: async (input) => {
    const now = dependencies.now();
    const [saved] = await db
      .insert(channelConfig)
      .values({
        id: dependencies.createId(),
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: channelConfig.channelId,
        set: {
          authSource: input.authSource,
          inboxWatchEnabled: input.inboxWatchEnabled,
          scheduledSyncEnabled: input.scheduledSyncEnabled,
          syncIntervalMinutes: input.syncIntervalMinutes,
          providerConfig: input.providerConfig,
          updatedBy: input.updatedBy,
          updatedAt: now,
        },
      })
      .returning();

    if (saved === undefined) {
      throw new Error(`Failed to persist channel configuration for ${input.channelId}`);
    }
    return saved;
  },
});
