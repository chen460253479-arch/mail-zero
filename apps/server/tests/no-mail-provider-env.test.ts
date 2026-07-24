import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const providerEnvironmentPattern =
  /\b(NANGO_BASE_URL|NANGO_SECRET_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|MICROSOFT_CLIENT_ID|MICROSOFT_CLIENT_SECRET)\b/;

describe('mail provider configuration boundaries', () => {
  it('contains no mailbox provider configuration environment variables', () => {
    const runtimeAndExampleFiles = [
      '.env.example',
      'apps/server/src/env.ts',
      'apps/server/src/lib/auth.ts',
      'apps/server/src/lib/factories/google-subscription.factory.ts',
      'packages/cli/src/commands/fix-env.ts',
    ];

    for (const file of runtimeAndExampleFiles) {
      expect(read(file), file).not.toMatch(providerEnvironmentPattern);
    }
  });

  it('does not register or invoke Google or Microsoft social login', () => {
    expect(read('apps/server/src/lib/auth.ts')).not.toContain('socialProviders');
    expect(read('apps/server/src/routes/auth.ts')).not.toContain('/providers');
    expect(read('apps/mail/components/home/HomeContent.tsx')).not.toContain('signIn.social');
    expect(read('apps/mail/components/navigation.tsx')).not.toContain('signIn.social');
  });
});
