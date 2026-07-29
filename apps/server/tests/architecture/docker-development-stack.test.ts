import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Docker self-hosted stack', () => {
  it('builds and starts immutable images with one deployment command', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const deployCommand = packageJson.scripts['docker:deploy'] ?? '';

    expect(deployCommand.split(/\s*&&\s*/)).toEqual([
      'docker compose up --detach --build --wait --wait-timeout 180',
      'docker compose ps',
    ]);
    expect(deployCommand).not.toMatch(
      /install-dependencies|\bdown\b|--volumes|db:push|db:migrate|db:seed/,
    );
  });

  it('runs frontend and backend independently without a Protocol Worker service', () => {
    const compose = read('compose.yaml');

    for (const service of ['mail', 'server', 'db', 'valkey', 'upstash-proxy']) {
      expect(compose).toMatch(new RegExp(`^  ${service}:`, 'm'));
    }
    expect(compose).not.toMatch(/^  protocol-worker:/m);
    expect(compose).not.toMatch(/^x-zero-development:/m);
    expect(compose).not.toContain('zerodotemail-protocol-worker');
    expect(compose).not.toContain('CLOUDFLARE_HYPERDRIVE');
    expect(compose).not.toContain('WRANGLER_HYPERDRIVE');
    expect(compose).not.toContain('MAIL_PROTOCOL_WORKER');
    expect(compose).not.toContain('zero-wrangler-state');
    expect(compose).not.toContain('- .:/app');
    expect(compose).not.toContain('/app/node_modules');
    expect(compose).toContain('image: zero-mail-runtime');
    expect(compose).toContain('image: zero-server');
    expect(compose).toContain('zero-mail-blobs:/var/lib/zero/mail-blobs');
  });

  it('uses one Compose definition and no retired development image', () => {
    const compose = read('compose.yaml');

    expect(compose).toMatch(/^name: zero$/m);
    expect(compose).not.toContain('include:');
    expect(compose).not.toContain('profiles:');
    expect(existsSync(resolve(root, 'docker/Dockerfile'))).toBe(false);
    expect(existsSync(resolve(root, 'docker/entrypoint.sh'))).toBe(false);
    expect(existsSync(resolve(root, 'docker/server/write-runtime-env.mjs'))).toBe(false);
  });

  it('documents the native Node self-hosted deployment workflow', () => {
    const env = read('.env.example');
    const readme = read('README.md');

    expect(env).not.toContain('ZERO_WRANGLER_ENV');
    expect(env).not.toContain('MAIL_PROTOCOL_WORKER_URL');
    expect(env).not.toContain('MAIL_PROTOCOL_WORKER_SECRET');
    expect(env).toContain('MAIL_BLOB_ROOT=/var/lib/zero/mail-blobs');
    expect(readme).toContain('pnpm docker:deploy');
    expect(readme).toContain('native Node.js');
    expect(readme).toContain('docker compose up --detach --build --no-deps mail');
    expect(readme).toContain('docker compose up --detach --build --no-deps server');
    expect(readme).not.toContain('immutable Worker Bundle');
    expect(readme).not.toContain('Wrangler remains');
    expect(readme).not.toContain('Protocol Worker dependency volumes');
  });

  it('keeps database schema deployment outside production Compose', () => {
    const compose = read('compose.yaml');

    expect(compose).not.toMatch(/^  migrations:/m);
    expect(compose).not.toContain('service_completed_successfully');
    expect(compose).not.toContain('docker/db/Dockerfile');
  });
});
