import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

type ComposeService = {
  build?: { context?: string; dockerfile?: string };
  command?: string[] | null;
  environment?: Record<string, string>;
  image?: string;
  volumes?: unknown[];
};

type ComposeConfig = {
  services: Record<string, ComposeService>;
};

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(architectureRoot, '../../../..');
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

const result = spawnSync(
  'docker',
  ['compose', '--project-directory', repoRoot, 'config', '--format', 'json'],
  { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  throw new Error(`docker compose config failed: ${result.stderr}`);
}

const compose = JSON.parse(result.stdout) as ComposeConfig;

describe('Docker Server immutable runtime', () => {
  it('runs Server from a dedicated image without development mounts', () => {
    const server = compose.services.server;
    const volumeTargets = (server.volumes ?? []).map((volume) =>
      typeof volume === 'object' && volume !== null && 'target' in volume
        ? String(volume.target)
        : '',
    );

    expect(server.image).toBe('zero-server-runtime');
    expect(server.build?.dockerfile).toBe('docker/server/Dockerfile');
    expect(server.command ?? null).toBeNull();
    expect(volumeTargets).toEqual(['/var/lib/zero/wrangler']);
    expect(server.environment).not.toHaveProperty('CHOKIDAR_USEPOLLING');
    expect(server.environment).not.toHaveProperty('CHOKIDAR_INTERVAL');
    expect(server.environment).not.toHaveProperty('ZERO_DOCKER_DEV');
  });

  it('builds the Worker Bundle before starting the runtime image', () => {
    const serverDockerfile = read('docker/server/Dockerfile');
    const serverEntrypoint = read('docker/server/entrypoint.sh');

    expect(serverDockerfile).toContain('wrangler deploy --dry-run');
    expect(serverDockerfile).toContain('--outdir /app/server-dist');
    expect(serverDockerfile).not.toContain('--outfile');
    expect(serverDockerfile).toContain('FROM node:22-bookworm-slim AS runtime');
    expect(serverDockerfile).not.toMatch(/FROM node:22-bookworm-slim AS runtime[\s\S]*COPY \. \./);
    expect(serverEntrypoint).toContain('--no-bundle');
    expect(serverEntrypoint).toContain('/app/server-dist/main.js');
    expect(serverEntrypoint).toContain('--persist-to /var/lib/zero/wrangler');
    expect(serverEntrypoint).not.toContain('pnpm install');
    expect(serverEntrypoint).not.toContain('wrangler deploy');
    expect(serverEntrypoint).not.toContain('--var');
  });

  it('keeps environment files outside the Docker build context', () => {
    const dockerignore = read('.dockerignore');

    expect(dockerignore).toMatch(/^\.env$/m);
    expect(dockerignore).toContain('**/.dev.vars');
  });
});
