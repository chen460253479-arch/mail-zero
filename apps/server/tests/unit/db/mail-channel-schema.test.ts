import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { channelConfig, channelIntegrationMapping, connection } from '../../../src/db/schema';
import { remoteEmail } from '../../../src/modules/mail/postgres/schema/emails';
import { inboundSync } from '../../../src/modules/mail-sync/postgres/schema';

const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).checks.map(({ name }) => name);

describe('mail channel database boundaries', () => {
  it('constrains every persisted channel identifier to a registered mail channel', () => {
    expect(checkNames(connection)).toContain('connection_channel_id_chk');
    expect(checkNames(channelConfig)).toContain('channel_config_channel_id_chk');
    expect(checkNames(channelIntegrationMapping)).toContain('channel_mapping_channel_id_chk');
    expect(checkNames(inboundSync)).toContain('inbound_sync_provider_chk');
    expect(checkNames(remoteEmail)).toContain('remote_email_provider_chk');
  });
});
