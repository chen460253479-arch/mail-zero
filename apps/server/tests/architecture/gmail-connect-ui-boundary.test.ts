import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Gmail connection UI boundary', () => {
  it('routes mailbox connection through the one globally selected authorization source', () => {
    const addDialog = read('apps/mail/components/connection/add.tsx');
    const gmailDialog = read('apps/mail/components/connection/gmail-connect-dialog.tsx');

    expect(addDialog).toContain('emailProviders.map');
    expect(addDialog).toContain("options.data.mode === 'zero_oauth'");
    expect(addDialog).toContain("options.data.mode === 'nango'");
    expect(addDialog).not.toContain("mode === 'choice'");
    expect(addDialog).not.toContain('zeroOAuthAvailable=');
    expect(addDialog).not.toContain('nangoAvailable=');
    expect(addDialog).not.toContain('NangoConnectDialog');
    expect(gmailDialog).toContain('listNangoGmailConnections');
    expect(gmailDialog).not.toContain('startZeroOAuth');
    expect(gmailDialog).not.toContain('zeroOAuthAvailable');
    expect(gmailDialog).not.toContain('>Nango<');
  });

  it('does not use social login or accept client-selected Nango integrations', () => {
    for (const file of [
      'apps/mail/components/connection/add.tsx',
      'apps/mail/components/connection/gmail-connect-dialog.tsx',
      'apps/mail/app/(routes)/settings/connections/page.tsx',
    ]) {
      expect(read(file), file).not.toContain('linkSocial');
    }

    const route = read('apps/server/src/trpc/routes/connections.ts');
    expect(route).not.toContain('nangoChannels:');
    expect(route).not.toContain('nangoConnections:');
    expect(route).toContain('.input(z.object({ connectionId: z.string().min(1) }))');
  });
});
