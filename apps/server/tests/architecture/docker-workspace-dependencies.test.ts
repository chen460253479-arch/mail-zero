import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Docker immutable dependencies', () => {
  it('installs dependencies only while building the Server image', () => {
    const dockerfile = read('docker/server/Dockerfile');
    const entrypoint = read('docker/server/entrypoint.sh');
    const compose = read('compose.yaml');

    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('--prod deploy --legacy /app/server-runtime');
    expect(entrypoint).not.toContain('pnpm');
    expect(compose).not.toContain('install-dependencies');
    expect(compose).not.toContain('node_modules');
    expect(compose).not.toContain('.zero-dependencies-fingerprint');
  });

  it('removes the retired source-mounted development bootstrap', () => {
    expect(existsSync(resolve(root, 'docker/Dockerfile'))).toBe(false);
    expect(existsSync(resolve(root, 'docker/entrypoint.sh'))).toBe(false);
    expect(existsSync(resolve(root, 'docker/server/write-runtime-env.mjs'))).toBe(false);
  });
});
