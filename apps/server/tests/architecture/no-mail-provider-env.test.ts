import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const providerOAuthEnvironmentPattern =
  /\b(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|MICROSOFT_CLIENT_ID|MICROSOFT_CLIENT_SECRET|ZOHO_CLIENT_ID|ZOHO_CLIENT_SECRET)\b/;

describe('mail provider configuration boundaries', () => {
  it('keeps provider OAuth clients out of environment variables while Nango stays server-managed', () => {
    const runtimeAndExampleFiles = [
      '.env.example',
      'apps/server/src/env.ts',
      'apps/server/src/lib/auth.ts',
      'packages/cli/src/commands/fix-env.ts',
    ];

    for (const file of runtimeAndExampleFiles) {
      expect(read(file), file).not.toMatch(providerOAuthEnvironmentPattern);
    }
    expect(read('.env.example')).toContain('NANGO_BASE_URL=');
    expect(read('.env.example')).toContain('NANGO_SECRET_KEY=');
    expect(read('apps/server/src/env.ts')).toContain('NANGO_BASE_URL?: string');
    expect(read('apps/server/src/env.ts')).toContain('NANGO_SECRET_KEY?: string');
    for (const channel of ['GMAIL', 'OUTLOOK', 'ZOHO_MAIL', 'IMAP_SMTP']) {
      expect(read('.env.example')).toContain(`NANGO_${channel}_INTEGRATION_KEY=`);
      expect(read('apps/server/src/env.ts')).toContain(`NANGO_${channel}_INTEGRATION_KEY?: string`);
    }
  });

  it('does not register or invoke Google or Microsoft social login', () => {
    expect(read('apps/server/src/lib/auth.ts')).not.toContain('socialProviders');
    expect(read('apps/server/src/routes/auth.ts')).not.toContain('/providers');
    expect(read('apps/mail/components/home/HomeContent.tsx')).not.toContain('signIn.social');
    expect(read('apps/mail/components/navigation.tsx')).not.toContain('signIn.social');
  });
});
