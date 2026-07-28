import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const repoRoot = resolve(serverRoot, '../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const listSourceFiles = (relativeDirectory: string): string[] =>
  readdirSync(resolve(repoRoot, relativeDirectory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return listSourceFiles(relativePath);
    return /\.[jt]sx?$/.test(entry.name) ? [relativePath] : [];
  });

describe('Nango credential boundary', () => {
  it('keeps Nango secrets and credential payloads out of the mail frontend', () => {
    for (const relativePath of [
      ...listSourceFiles('apps/mail/app'),
      ...listSourceFiles('apps/mail/components'),
      ...listSourceFiles('apps/mail/hooks'),
      ...listSourceFiles('apps/mail/lib'),
      ...listSourceFiles('apps/mail/providers'),
    ]) {
      const source = read(relativePath);
      for (const forbidden of ['NANGO_SECRET_KEY', 'access_token', 'refresh_token']) {
        expect(
          source.includes(forbidden),
          `${relativePath} exposes the forbidden Nango credential field ${forbidden}`,
        ).toBe(false);
      }
    }
  });

  it('does not ask Nango to refresh tokens during ordinary connection reads', () => {
    const client = read('apps/server/src/lib/nango/client.ts');
    expect(client).not.toContain('refresh_token');
    expect(client).toContain('provider_config_key');
  });

  it('returns only explicit safe fields from the Nango connection browser', () => {
    const binding = read('apps/server/src/lib/nango/bind.ts');
    expect(binding).toContain('connectionId: summary.connection_id');
    expect(binding).toContain(
      "authorizationStatus: summary.errors.length === 0 && !fallbackFailed ? 'valid' : 'invalid'",
    );
    expect(binding).not.toMatch(/return\s+\{\s*\.\.\.connection/s);
  });

  it('keeps local disconnect independent from Nango connection deletion', () => {
    const lifecycle = read('apps/server/src/lib/connection-lifecycle.ts');
    expect(lifecycle).not.toContain('NangoClient');
    expect(lifecycle).not.toContain('deleteNango');
    expect(lifecycle).not.toContain('/connections/');
  });
});
