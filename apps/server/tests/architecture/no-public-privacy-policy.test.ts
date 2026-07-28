import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const repoRoot = resolve(serverRoot, '../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('public privacy policy removal', () => {
  it('does not expose the public privacy-policy route or links', () => {
    expect(existsSync(resolve(repoRoot, 'apps/mail/app/(full-width)/privacy.tsx'))).toBe(false);
    expect(read('apps/mail/app/routes.ts')).not.toContain(
      "route('/privacy', '(full-width)/privacy.tsx')",
    );

    const publicSurfaceFiles = [
      'apps/mail/app/(auth)/zero/login/page.tsx',
      'apps/mail/app/(auth)/zero/signup/page.tsx',
      'apps/mail/components/home/footer.tsx',
      'apps/mail/components/navigation.tsx',
      'apps/mail/components/ui/nav-user.tsx',
    ];

    for (const path of publicSurfaceFiles) {
      expect(read(path), `${path} still links to /privacy`).not.toMatch(
        /(?:href|to)=["']\/privacy["']/,
      );
    }
  });

  it('preserves authenticated mailbox privacy settings', () => {
    expect(existsSync(resolve(repoRoot, 'apps/mail/app/(routes)/settings/privacy/page.tsx'))).toBe(
      true,
    );
    expect(read('apps/mail/app/routes.ts')).toContain(
      "route('/privacy', '(routes)/settings/privacy/page.tsx')",
    );
    expect(read('apps/mail/config/navigation.ts')).toContain("url: '/settings/privacy'");
  });
});
