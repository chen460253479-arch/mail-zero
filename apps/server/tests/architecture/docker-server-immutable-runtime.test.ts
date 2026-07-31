import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

type ComposeVolume = {
  source?: string;
  target?: string;
  type?: string;
};

type ComposeService = {
  build?: { context?: string; dockerfile?: string };
  command?: string[] | null;
  environment?: Record<string, string>;
  image?: string;
  volumes?: ComposeVolume[];
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
  it('runs one native Node backend against S3 without a local Blob volume', () => {
    const server = compose.services.server;

    expect(server.image).toBe('zero-server');
    expect(server.build?.dockerfile).toBe('docker/server/Dockerfile');
    expect(server.command ?? null).toBeNull();
    expect(server.volumes ?? []).toHaveLength(0);
    expect(server.environment).toHaveProperty('MAIL_BLOB_STORE', 's3');
    for (const requiredSetting of [
      'MAIL_BLOB_S3_ENDPOINT',
      'MAIL_BLOB_S3_REGION',
      'MAIL_BLOB_S3_BUCKET',
      'MAIL_BLOB_S3_PREFIX',
      'MAIL_BLOB_S3_ACCESS_KEY_ID',
      'MAIL_BLOB_S3_SECRET_ACCESS_KEY',
    ]) {
      expect(server.environment).toHaveProperty(requiredSetting);
    }
    for (const forbidden of [
      'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE',
      'WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE',
      'MAIL_PROTOCOL_WORKER_URL',
      'MAIL_PROTOCOL_WORKER_SECRET',
      'ZERO_WRANGLER_ENV',
    ]) {
      expect(server.environment).not.toHaveProperty(forbidden);
    }
  });

  it('builds and starts a Node 22 artifact without Wrangler or workerd', () => {
    const dockerfile = read('docker/server/Dockerfile');
    const entrypoint = read('docker/server/entrypoint.sh');
    const packageJson = read('apps/server/package.json');
    const bundleVerification = read('apps/server/scripts/verify-bundle.mjs');
    const viteConfig = read('apps/server/vite.node.config.ts');

    expect(packageJson).toContain(
      '"build": "vite build --config vite.node.config.ts && node scripts/verify-bundle.mjs"',
    );
    expect(bundleVerification).toContain(
      "await import(new URL('../dist/main.js', import.meta.url))",
    );
    expect(bundleVerification).toContain('process.exit(0)');
    expect(viteConfig).toContain("ssr: 'src/runtime/node/main.ts'");
    expect(viteConfig).toContain("entryFileNames: 'main.js'");
    expect(viteConfig).toContain("'@zero/mail-core'");
    expect(dockerfile).toContain('pnpm --filter @zero/server build');
    expect(dockerfile).toContain(
      'pnpm --filter @zero/server --prod deploy --legacy /app/server-runtime',
    );
    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS runtime');
    expect(dockerfile).not.toContain('/var/lib/zero/mail-blobs');
    expect(dockerfile).not.toContain('MAIL_BLOB_ROOT');
    expect(dockerfile).not.toContain('wrangler');
    expect(dockerfile).not.toContain('workerd');
    expect(dockerfile).not.toMatch(/FROM node:22-bookworm-slim AS runtime[\s\S]*COPY \. \./);
    expect(entrypoint).toContain('exec node /app/dist/main.js');
    expect(entrypoint).not.toContain('pnpm install');
    expect(entrypoint).not.toContain('wrangler');
  });

  it('provides an operator check for the built runtime image', () => {
    const inspection = read('scripts/inspect-server-image.mjs');

    expect(inspection).toContain("const image = process.argv[2] ?? 'zero-server'");
    expect(inspection).toContain('docker');
    expect(inspection).toContain('/app/dist/main.js');
    expect(inspection).toContain('wrangler');
    expect(inspection).toContain('workerd');
    expect(inspection).toContain('/app/src');
  });

  it('keeps environment files outside the Docker build context', () => {
    const dockerignore = read('.dockerignore');

    expect(dockerignore).toMatch(/^\.env$/m);
    expect(dockerignore).toContain('**/.dev.vars');
  });
});
