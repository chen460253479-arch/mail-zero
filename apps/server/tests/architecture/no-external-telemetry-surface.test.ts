import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const repositoryRoot = resolve(serverRoot, '../..');
const readSource = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const readManifest = (path: string): PackageManifest =>
  JSON.parse(readSource(path)) as PackageManifest;

const dependencyNames = (manifest: PackageManifest): string[] => [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
];

describe('external analytics and error-reporting removal', () => {
  it('does not load Dub Analytics or Sentry in the browser runtime', () => {
    const instrumentPath = resolve(repositoryRoot, 'apps/mail/app/instrument.ts');
    const entrypoints = ['apps/mail/app/root.tsx', 'apps/mail/app/entry.client.tsx'];
    const forbiddenTokens = [
      '@dub/analytics',
      'DubAnalytics',
      '@sentry/react',
      'Sentry.captureException',
      'Sentry.reactErrorHandler',
      './instrument',
    ];
    const violations = entrypoints.flatMap((path) => {
      const source = readSource(path);
      return forbiddenTokens
        .filter((token) => source.includes(token))
        .map((token) => `${path}:${token}`);
    });

    expect(existsSync(instrumentPath)).toBe(false);
    expect(violations).toEqual([]);
  });

  it('does not load Dub or expose a Sentry relay in the server runtime', () => {
    const entrypoints = ['apps/server/src/lib/auth.ts', 'apps/server/src/main.ts'];
    const forbiddenTokens = [
      '@dub/better-auth',
      "from 'dub'",
      'new Dub',
      'dubAnalytics',
      'SENTRY_HOST',
      'SENTRY_PROJECT_IDS',
      'monitoring/sentry',
      'ingest.us.sentry.io',
    ];
    const violations = entrypoints.flatMap((path) => {
      const source = readSource(path);
      return forbiddenTokens
        .filter((token) => source.includes(token))
        .map((token) => `${path}:${token}`);
    });

    expect(violations).toEqual([]);
  });

  it('contains no direct or locked Dub and Sentry dependencies', () => {
    const manifests = ['apps/mail/package.json', 'apps/server/package.json'];
    const forbiddenDependencies = ['@dub/analytics', '@dub/better-auth', '@sentry/react', 'dub'];
    const manifestViolations = manifests.flatMap((path) => {
      const dependencies = dependencyNames(readManifest(path));
      return forbiddenDependencies
        .filter((dependency) => dependencies.includes(dependency))
        .map((dependency) => `${path}:${dependency}`);
    });
    const workspace = readSource('pnpm-workspace.yaml');
    const lockfile = readSource('pnpm-lock.yaml');
    const forbiddenLockfileRecords = [
      "'@dub/analytics@",
      "'@dub/better-auth@",
      "'@sentry-internal/",
      "'@sentry/browser@",
      "'@sentry/core@",
      "'@sentry/react@",
      'dub@0.',
    ];

    expect(manifestViolations).toEqual([]);
    expect(workspace).not.toContain('@sentry/cli');
    expect(forbiddenLockfileRecords.filter((record) => lockfile.includes(record))).toEqual([]);
  });
});
