import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Docker self-hosted stack', () => {
  it('delegates deployment to the single-service deployment entrypoint', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const deployCommand = packageJson.scripts['docker:deploy'] ?? '';

    expect(deployCommand).toBe('node scripts/docker-deploy.mjs');
    expect(deployCommand).not.toMatch(
      /install-dependencies|\bdown\b|--volumes|db:push|db:migrate|db:seed/,
    );
    expect(packageJson.scripts).not.toHaveProperty('docker:cache:up');
    expect(packageJson.scripts).not.toHaveProperty('docker:cache:stop');
    expect(packageJson.scripts).not.toHaveProperty('docker:cache:down');
  });

  it('requires exactly one supported service and builds only that service', async () => {
    const scriptPath = resolve(root, 'scripts/docker-deploy.mjs');

    expect(existsSync(scriptPath)).toBe(true);
    if (!existsSync(scriptPath)) return;

    const deployment = (await import(pathToFileURL(scriptPath).href)) as {
      createDockerDeployPlan(args: string[]): string[][];
    };

    expect(() => deployment.createDockerDeployPlan([])).toThrow(
      '用法: pnpm docker:deploy <mail|server>',
    );
    expect(() => deployment.createDockerDeployPlan(['db'])).toThrow(
      '用法: pnpm docker:deploy <mail|server>',
    );
    expect(() => deployment.createDockerDeployPlan(['mail', 'server'])).toThrow(
      '用法: pnpm docker:deploy <mail|server>',
    );
    expect(deployment.createDockerDeployPlan(['mail'])).toEqual([
      [
        'compose',
        'up',
        '--detach',
        '--build',
        '--no-deps',
        '--wait',
        '--wait-timeout',
        '180',
        'mail',
      ],
      ['compose', 'ps', 'mail'],
    ]);
    expect(deployment.createDockerDeployPlan(['server'])).toEqual([
      [
        'compose',
        'up',
        '--detach',
        '--build',
        '--no-deps',
        '--wait',
        '--wait-timeout',
        '180',
        'server',
      ],
      ['compose', 'ps', 'server'],
    ]);
  });

  it('runs frontend and backend independently without a Protocol Worker service', () => {
    const compose = read('compose.yaml');
    const servicesSection = compose.split(/^volumes:/m, 1)[0] ?? compose;
    const serviceNames = [...servicesSection.matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].map(
      ([, serviceName]) => serviceName,
    );

    expect(serviceNames).toEqual(['mail', 'server']);
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
    expect(compose).toContain("DATABASE_URL: '${DATABASE_URL:?DATABASE_URL is required}'");
    expect(compose).not.toContain('zerodotemail-db');
    expect(compose).not.toContain('postgres-data');
    expect(compose).not.toContain('POSTGRES_USER');
    expect(compose).not.toContain('POSTGRES_PASSWORD');
    expect(compose).not.toContain('POSTGRES_DB');
    expect(compose).not.toContain('zerodotemail-redis');
    expect(compose).not.toContain('zerodotemail-upstash-proxy');
    expect(compose).not.toContain('bitnami/valkey');
    expect(compose).not.toContain('serverless-redis-http');
    expect(compose).not.toContain('REDIS_URL');
    expect(compose).not.toContain('REDIS_TOKEN');
    expect(compose).not.toContain('valkey-data');
    expect(compose).not.toContain('zero-mail-blobs');
    expect(compose).toContain('MAIL_BLOB_STORE: s3');
    expect(compose).toContain('MAIL_BLOB_S3_ENDPOINT: ${MAIL_BLOB_S3_ENDPOINT:-}');
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
    const testingEnv = read('packages/testing/.env.example');
    const readme = read('README.md');

    expect(env).not.toContain('ZERO_WRANGLER_ENV');
    expect(env).not.toContain('MAIL_PROTOCOL_WORKER_URL');
    expect(env).not.toContain('MAIL_PROTOCOL_WORKER_SECRET');
    expect(env).not.toContain('MAIL_BLOB_ROOT');
    expect(env).toContain('MAIL_BLOB_STORE=s3');
    expect(env).toContain('MAIL_BLOB_S3_ENDPOINT=https://objects.example.com');
    expect(env).toContain('MAIL_BLOB_S3_BUCKET=your-private-mail-bucket');
    expect(env).not.toContain('BETTER_AUTH_URL');
    expect(env).not.toContain('PLAYWRIGHT_SESSION_TOKEN');
    expect(env).not.toContain('PLAYWRIGHT_SESSION_DATA');
    expect(env).not.toMatch(/^EMAIL\s*=/mu);
    expect(testingEnv).toContain('PLAYWRIGHT_SESSION_TOKEN=');
    expect(testingEnv).toContain('PLAYWRIGHT_SESSION_DATA=');
    expect(testingEnv).toContain('PLAYWRIGHT_TEST_EMAIL=');
    expect(testingEnv).toContain('PLAYWRIGHT_BASE_URL=');
    expect(readme).toContain('pnpm docker:deploy mail');
    expect(readme).toContain('pnpm docker:deploy server');
    expect(readme).not.toMatch(/^\s*pnpm docker:deploy\s*$/m);
    expect(readme).toContain('native Node.js');
    expect(readme).not.toContain('docker compose up --detach --build --no-deps mail');
    expect(readme).not.toContain('docker compose up --detach --build --no-deps server');
    expect(readme).not.toContain('immutable Worker Bundle');
    expect(readme).not.toContain('Wrangler remains');
    expect(readme).not.toContain('Protocol Worker dependency volumes');
  });

  it('passes external mail integration settings into the Server container', () => {
    const compose = read('compose.yaml');

    expect(compose).toContain('INTEGRATION_API_TOKEN: ${INTEGRATION_API_TOKEN:-}');
    expect(compose).toContain('MAIL_WEBHOOK_ENABLED: ${MAIL_WEBHOOK_ENABLED:-false}');
    expect(compose).toContain('MAIL_WEBHOOK_URL: ${MAIL_WEBHOOK_URL:-}');
  });

  it('keeps database schema deployment outside production Compose', () => {
    const compose = read('compose.yaml');

    expect(compose).not.toMatch(/^  migrations:/m);
    expect(compose).not.toContain('docker/db/Dockerfile');
  });
});
