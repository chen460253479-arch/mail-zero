import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Docker development stack', () => {
  it('provides a safe full-stack Docker deployment command', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const deployCommand = packageJson.scripts['docker:deploy'] ?? '';
    const deploySteps = deployCommand.split(/\s*&&\s*/);

    expect(deploySteps).toEqual([
      'docker compose build',
      'docker compose run --rm --no-deps server install-dependencies',
      'docker compose up --detach --wait --wait-timeout 180',
      'docker compose ps',
    ]);
    expect(deployCommand).not.toMatch(/\bdown\b|--volumes|db:push|db:migrate|db:seed/);
  });

  it('uses one local Compose file during the static Mail transition', () => {
    const compose = read('compose.yaml');
    const env = read('.env.example');
    const packageJson = read('package.json');

    expect(compose).toMatch(/^name: zero$/m);
    expect(compose).not.toContain('include:');
    expect(compose).not.toContain('ZERO_COMPOSE_FILE');
    expect(compose).not.toContain('profiles:');
    expect(compose).not.toMatch(/^  app:/m);
    expect(env).not.toContain('COMPOSE_PROFILES');
    expect(env).not.toContain('ZERO_RUNTIME_ENV');
    expect(env).not.toContain('ZERO_COMPOSE_FILE');
    expect(existsSync(resolve(root, 'docker-compose.dev.yaml'))).toBe(false);
    expect(existsSync(resolve(root, 'docker-compose.prod.yaml'))).toBe(false);
    expect(existsSync(resolve(root, 'docker/app'))).toBe(false);
    expect(packageJson).not.toContain('docker-compose.db.yaml');
  });

  it('runs the full local stack as independently managed services', () => {
    const compose = read('compose.yaml');

    for (const service of ['mail', 'server', 'db', 'valkey', 'upstash-proxy']) {
      expect(compose).toMatch(new RegExp(`^  ${service}:`, 'm'));
    }
    expect(compose).not.toMatch(/^  app:/m);
    expect(compose).not.toMatch(/^  migrations:/m);
    expect(compose).toContain('container_name: zerodotemail-mail');
    expect(compose).toContain('container_name: zerodotemail-server');
    expect(compose).toContain('container_name: zerodotemail-db');
    expect(compose).toContain('container_name: zerodotemail-redis');
    expect(compose).toContain('container_name: zerodotemail-upstash-proxy');
    expect(compose).toContain('CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE');
    expect(compose).toContain('WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE');
    expect(compose).toContain('image: docker.io/bitnami/valkey:latest');
    expect(compose).toContain('postgres-data:/var/lib/postgresql/data');
    expect(compose).toContain('valkey-data:/bitnami/valkey/data');
    expect(compose).toContain('http://127.0.0.1:3000/health');
    expect(compose).not.toContain('/@vite/client');
    expect(compose).toContain("fetch('http://127.0.0.1:8787/health')");
    expect([...compose.matchAll(/process\.exit\(response\.ok \? 0 : 1\)/g)]).toHaveLength(1);
  });

  it('keeps Linux dependencies outside the Windows source mount', () => {
    const compose = read('compose.yaml');
    const viteConfig = read('apps/mail/vite.config.ts');

    expect(compose).toContain('- .:/app');
    expect(compose).toContain('/app/node_modules');
    expect(compose).toContain('/app/apps/mail/node_modules');
    expect(compose).toContain('/app/apps/server/node_modules');
    expect(compose).toContain('CHOKIDAR_USEPOLLING');
    expect(compose).toMatch(/CHOKIDAR_INTERVAL: ['"]1000['"]/);
    expect(compose).toContain('ZERO_DOCKER_DEV');
    expect(viteConfig).toContain("process.env.ZERO_DOCKER_DEV === 'true'");
    expect(viteConfig).toContain('...reactCompilerPlugins');
  });

  it('uses a dedicated development image and entrypoint', () => {
    const compose = read('compose.yaml');
    const dockerfile = read('docker/Dockerfile');
    const entrypoint = read('docker/entrypoint.sh');
    const mailDockerfile = read('docker/mail/Dockerfile');
    const mailNginx = read('docker/mail/nginx.conf');

    expect(compose).toMatch(/  server:\n(?:    .*\n)*?    build:/);
    expect(compose.match(/dockerfile: docker\/Dockerfile/g)).toHaveLength(1);
    expect(compose).toContain('dockerfile: docker/mail/Dockerfile');
    expect(dockerfile).toContain('FROM node:22-bookworm-slim');
    expect(dockerfile).toContain('libc++1');
    expect(dockerfile).toContain('pnpm@10.15.0');
    expect(dockerfile).toContain('COPY docker/entrypoint.sh /usr/local/bin/zero-dev-entrypoint');
    expect(dockerfile).toContain('ENTRYPOINT ["zero-dev-entrypoint"]');
    expect(entrypoint).not.toContain('pnpm --dir apps/mail dev');
    expect(entrypoint).toContain('wrangler dev');
    expect(entrypoint).not.toContain('migrations)');
    expect(entrypoint).not.toContain('db:push');
    expect(mailDockerfile).toContain('FROM node:22-bookworm-slim AS builder');
    expect(mailDockerfile).toContain('pnpm@10.15.0');
    expect(mailDockerfile).toContain('pnpm --filter @zero/mail build');
    expect(mailDockerfile).toContain('FROM nginx:1.28-alpine AS runtime');
    expect(mailDockerfile).toContain('apps/mail/build/client');
    expect(mailNginx).toContain('location = /health');
    expect(mailNginx).toContain('max-age=31536000, immutable');
    expect(mailNginx).toContain('try_files $uri $uri/ /index.html');
  });

  it('keeps the development runtime script with its image', () => {
    const attributes = read('.gitattributes');
    const script = read('docker/entrypoint.sh');

    expect(attributes).toContain('*.sh text eol=lf');
    expect(script).not.toContain('\r\n');
    expect(existsSync(resolve(root, 'docker/dev'))).toBe(false);
    expect(existsSync(resolve(root, 'scripts/docker'))).toBe(false);
  });

  it('documents the Docker runtime controls in the environment template', () => {
    const env = read('.env.example');

    expect(env).toContain('ZERO_WRANGLER_ENV=local');
    expect(env).not.toContain('COMPOSE_PROFILES');
    expect(env).not.toContain('ZERO_RUNTIME_ENV');
    expect(env).toContain('ZERO_MAIL_PORT=3000');
    expect(env).toContain('ZERO_SERVER_PORT=8787');
  });

  it('documents Docker as the default development workflow', () => {
    const readme = read('README.md');

    expect(readme).toContain('docker compose up --build --detach');
    expect(readme).toContain('docker compose logs --follow');
    expect(readme).toContain('Mail as a prebuilt Nginx static site');
    expect(readme).toContain('Server source changes are hot-reloaded');
    expect(readme).toContain('docker compose up --detach --build --no-deps mail');
    expect(readme).toContain('docker compose restart mail');
    expect(readme).not.toContain('COMPOSE_PROFILES');
    expect(readme).not.toContain('production application container');
    expect(readme).not.toContain('applies migrations automatically');
  });

  it('keeps database schema deployment outside production Compose', () => {
    const compose = read('compose.yaml');

    expect(compose).not.toMatch(/^  migrations:/m);
    expect(compose).not.toContain('service_completed_successfully');
    expect(compose).not.toContain('docker/db/Dockerfile');
    expect(existsSync(resolve(root, 'docker/db/Dockerfile'))).toBe(false);
  });
});
