import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type ComposeService = {
  build?: { args?: Record<string, string>; context?: string; dockerfile?: string };
  command?: string[] | null;
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
  image?: string;
  volumes?: unknown[];
};

type ComposeConfig = {
  services: Record<string, ComposeService>;
};

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(architectureRoot, '../../../..');

const result = spawnSync(
  'docker',
  ['compose', '--project-directory', repoRoot, 'config', '--format', 'json'],
  { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  throw new Error(`docker compose config failed: ${result.stderr}`);
}

const compose = JSON.parse(result.stdout) as ComposeConfig;

describe('Docker Mail static runtime', () => {
  it('builds Mail as an isolated static image', () => {
    const mail = compose.services.mail;

    expect(mail.image).toBe('zero-mail-runtime');
    expect(mail.build?.dockerfile).toBe('docker/mail/Dockerfile');
    expect(mail.command ?? null).toBeNull();
    expect(mail.volumes ?? []).toHaveLength(0);
    expect(mail.environment ?? {}).toEqual({});
    expect(mail.healthcheck?.test?.join(' ')).toContain('http://127.0.0.1:3000/health');
    expect(mail.healthcheck?.test?.join(' ')).not.toContain('/@vite/client');
  });

  it('passes only public browser configuration into the Mail build', () => {
    const buildArgs = compose.services.mail.build?.args ?? {};

    expect(Object.keys(buildArgs).sort()).toEqual([
      'VITE_PUBLIC_APP_URL',
      'VITE_PUBLIC_BACKEND_URL',
      'VITE_PUBLIC_IMAGE_API_URL',
      'VITE_PUBLIC_IMAGE_PROXY',
    ]);
    expect(buildArgs).not.toHaveProperty('VITE_INTERNAL_BACKEND_URL');
    expect(buildArgs).not.toHaveProperty('DATABASE_URL');
    expect(buildArgs).not.toHaveProperty('REDIS_TOKEN');
    expect(buildArgs).not.toHaveProperty('NANGO_BASE_URL');
    expect(buildArgs).not.toHaveProperty('NANGO_SECRET_KEY');
    expect(buildArgs).not.toHaveProperty('NANGO_GMAIL_INTEGRATION_KEY');
    expect(buildArgs).not.toHaveProperty('NANGO_OUTLOOK_INTEGRATION_KEY');
    expect(buildArgs).not.toHaveProperty('NANGO_ZOHO_MAIL_INTEGRATION_KEY');
    expect(buildArgs).not.toHaveProperty('NANGO_IMAP_SMTP_INTEGRATION_KEY');
  });

  it('keeps Server on the persisted development runtime', () => {
    const server = compose.services.server;
    const volumeTargets = (server.volumes ?? []).map((volume) =>
      typeof volume === 'object' && volume !== null && 'target' in volume
        ? String(volume.target)
        : '',
    );

    expect(server.image).toBe('zero-development');
    expect(server.command).toEqual(['server']);
    expect(volumeTargets).toContain('/app');
    expect(volumeTargets).toContain('/app/node_modules');
    expect(server.environment).toHaveProperty('CHOKIDAR_USEPOLLING', 'true');
  });
});
