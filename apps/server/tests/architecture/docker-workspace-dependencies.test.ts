import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('Docker workspace dependency bootstrap', () => {
  it('requires an explicit command before refreshing persisted node_modules', async () => {
    const entrypoint = await readFile(resolve(process.cwd(), '../../docker/entrypoint.sh'), 'utf8');

    const refreshIndex = entrypoint.indexOf('pnpm install --frozen-lockfile');
    const explicitInstallIndex = entrypoint.indexOf('install-dependencies)');

    expect(refreshIndex).toBeGreaterThan(-1);
    expect(explicitInstallIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(explicitInstallIndex);
    expect(entrypoint).toContain('pnpm-lock.yaml');
    expect(entrypoint).toContain('scripts/package.json');
    expect(entrypoint).not.toContain('scripts/*/package.json');
    expect(entrypoint).toContain('.zero-dependencies-fingerprint');
    expect(entrypoint).toContain(
      'docker compose run --rm --no-deps protocol-worker install-dependencies',
    );
    expect(entrypoint).not.toContain(
      'Workspace dependencies changed; refreshing Docker node_modules volumes...',
    );
  });

  it('isolates every workspace node_modules directory from the host bind mount', async () => {
    const compose = await readFile(resolve(process.cwd(), '../../compose.yaml'), 'utf8');
    const entrypoint = await readFile(resolve(process.cwd(), '../../docker/entrypoint.sh'), 'utf8');

    const isolatedWorkspacePaths = [
      '/app/node_modules',
      '/app/apps/mail/node_modules',
      '/app/apps/server/node_modules',
      '/app/packages/cli/node_modules',
      '/app/packages/eslint-config/node_modules',
      '/app/packages/mail-core/node_modules',
      '/app/packages/testing/node_modules',
      '/app/packages/tsconfig/node_modules',
    ];

    for (const workspacePath of isolatedWorkspacePaths) {
      expect(compose).toContain(`:${workspacePath}`);
      expect(entrypoint).toContain(workspacePath);
    }
  });
});
