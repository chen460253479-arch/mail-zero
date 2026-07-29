import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('mail channel connection UI boundary', () => {
  it('routes every mailbox through its one globally selected authorization source', () => {
    const addDialog = read('apps/mail/components/connection/add.tsx');
    const connectMode = read('apps/mail/modules/mail-connections/connect-mode.ts');
    const nangoDialog = read('apps/mail/components/connection/nango-connect-dialog.tsx');

    expect(addDialog).toContain('emailProviders.map');
    expect(addDialog).toContain('getChannelAuthorizationOptions');
    expect(addDialog).toContain('resolveChannelConnectAction');
    expect(addDialog).not.toContain("mode === 'choice'");
    expect(addDialog).not.toContain('zeroOAuthAvailable=');
    expect(addDialog).not.toContain('nangoAvailable=');
    expect(addDialog).toContain('NangoConnectDialog');
    expect(connectMode).toContain("mode === 'zero_oauth'");
    expect(connectMode).toContain("mode === 'nango'");
    expect(connectMode).toContain("mode === 'manual'");
    expect(nangoDialog).toContain('listNangoConnections');
    expect(nangoDialog).toContain('bindNango');
  });

  it('does not use social login or accept client-selected Nango integrations', () => {
    for (const file of [
      'apps/mail/components/connection/add.tsx',
      'apps/mail/components/connection/nango-connect-dialog.tsx',
      'apps/mail/app/(routes)/settings/connections/page.tsx',
    ]) {
      expect(read(file), file).not.toContain('linkSocial');
    }

    const nangoDialog = read('apps/mail/components/connection/nango-connect-dialog.tsx');
    expect(nangoDialog).not.toContain('integrationId');
    expect(nangoDialog).toContain(
      'bind.mutateAsync({ channelId, connectionId: selectedConnectionId })',
    );

    const route = read('apps/server/src/trpc/routes/connections.ts');
    expect(route).not.toContain('nangoChannels:');
    expect(route).not.toContain('nangoConnections:');
    expect(route).toContain('const integrationId = mapping.externalIntegrationId');
  });
});
