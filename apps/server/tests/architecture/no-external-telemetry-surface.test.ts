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
  scripts?: Record<string, string>;
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

  it('does not retain PostHog browser analytics or public configuration', () => {
    const providerPath = resolve(repositoryRoot, 'apps/mail/lib/posthog-provider.tsx');
    const entrypoints = [
      'apps/mail/providers/client-providers.tsx',
      'apps/mail/components/create/create-email.tsx',
      'apps/mail/components/mail/reply-composer.tsx',
      'apps/mail/hooks/use-optimistic-actions.ts',
      'apps/server/src/env.ts',
    ];
    const forbiddenTokens = [
      'posthog-js',
      'PostHogProvider',
      'posthog.capture',
      'posthog.identify',
      'VITE_PUBLIC_POSTHOG_KEY',
      'VITE_PUBLIC_POSTHOG_HOST',
    ];
    const violations = entrypoints.flatMap((path) => {
      const source = readSource(path);
      return forbiddenTokens
        .filter((token) => source.includes(token))
        .map((token) => `${path}:${token}`);
    });

    expect(existsSync(providerPath)).toBe(false);
    expect(violations).toEqual([]);
  });

  it('contains no direct or locked external telemetry dependencies', () => {
    const manifests = ['package.json', 'apps/mail/package.json', 'apps/server/package.json'];
    const forbiddenDependencies = [
      '@coinbase/cookie-manager',
      '@dub/analytics',
      '@dub/better-auth',
      '@microlabs/otel-cf-workers',
      '@opentelemetry/api',
      '@sentry/react',
      'dub',
      'posthog-js',
    ];
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
      "'@coinbase/cookie-manager@",
      "'@microlabs/otel-cf-workers@",
      "'@sentry-internal/",
      "'@sentry/browser@",
      "'@sentry/core@",
      "'@sentry/react@",
      'dub@0.',
      'posthog-js@',
    ];

    expect(manifestViolations).toEqual([]);
    expect(workspace).not.toContain('@sentry/cli');
    expect(forbiddenLockfileRecords.filter((record) => lockfile.includes(record))).toEqual([]);
  });

  it('contains no dormant telemetry, analytics consent, or non-essential remote UI surface', () => {
    const sourceFiles = [
      'apps/mail/app/root.tsx',
      'apps/mail/app/routes.ts',
      'apps/mail/components/home/footer.tsx',
      'apps/mail/components/home/HomeContent.tsx',
      'apps/mail/components/navigation.tsx',
      'apps/server/src/env.ts',
      'apps/server/src/main.ts',
      'apps/server/src/trpc/index.ts',
    ];
    const forbiddenTokens = [
      'react-scan',
      'unpkg.com',
      'api.axiom.co',
      'AXIOM_',
      'OTEL_',
      'api.github.com/repos/',
      'placehold.co',
      'cookiePreferencesRouter',
      '/contributors',
    ];
    const violations = sourceFiles.flatMap((path) => {
      const source = readSource(path);
      return forbiddenTokens
        .filter((token) => source.includes(token))
        .map((token) => `${path}:${token}`);
    });
    const removedPaths = [
      'apps/mail/app/(full-width)/contributors.tsx',
      'apps/server/src/lib/cookies.ts',
      'apps/server/src/lib/tracing.ts',
      'apps/server/src/trpc/routes/cookies.ts',
    ];

    expect(violations).toEqual([]);
    expect(removedPaths.filter((path) => existsSync(resolve(repositoryRoot, path)))).toEqual([]);
  });

  it('does not retain Sentry upload scripts or configuration scaffolding', () => {
    const rootManifest = readManifest('package.json');
    const scriptViolations = Object.entries(rootManifest.scripts ?? {})
      .filter(
        ([name, command]) => name.toLowerCase().includes('sentry') || command.includes('sentry'),
      )
      .map(([name]) => `package.json:${name}`);
    const mailGitignore = readSource('apps/mail/.gitignore');

    expect(scriptViolations).toEqual([]);
    expect(mailGitignore.toLowerCase()).not.toContain('sentry');
  });
});
