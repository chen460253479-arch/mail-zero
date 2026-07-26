import { dirname, extname, relative, resolve, sep } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const srcRoot = dirname(fileURLToPath(import.meta.url));

const canonicalRoots = [
  'modules/mail',
  'modules/mail-accounts',
  'modules/mail-sync',
  'modules/mail-outbound',
  'mail-channel',
  'integrations',
  'infrastructure/security',
  'runtime/mail',
] as const;

const normalizePath = (value: string): string => value.split(sep).join('/');

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });

const importSpecifierPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gu;

const readImports = (file: string): string[] => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(importSpecifierPattern)].map((match) => match[1] ?? match[2]!);
};

const resolveLocalImport = (file: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  return normalizePath(relative(srcRoot, resolve(dirname(file), specifier)));
};

const importsBelow = (
  root: string,
): Array<{ file: string; specifier: string; target: string | null }> =>
  collectTypeScriptFiles(resolve(srcRoot, root)).flatMap((file) =>
    readImports(file).map((specifier) => ({
      file: normalizePath(relative(srcRoot, file)),
      specifier,
      target: resolveLocalImport(file, specifier),
    })),
  );

describe('mail server architecture', () => {
  it('keeps every canonical mail module in its declared root', () => {
    const missing = canonicalRoots.filter((root) => !existsSync(resolve(srcRoot, root)));
    expect(missing).toEqual([]);
  });

  it('prevents canonical mail modules from importing the retired remote-mail implementation', () => {
    const forbiddenFragments = [
      'lib/driver',
      'lib/factories',
      'pipelines',
      'workflows/sync-threads-',
      'lib/server-utils',
    ];
    const violations = canonicalRoots
      .filter((root) => existsSync(resolve(srcRoot, root)))
      .flatMap(importsBelow)
      .filter(({ target }) =>
        target === null ? false : forbiddenFragments.some((fragment) => target.includes(fragment)),
      );

    expect(violations).toEqual([]);
  });

  it('keeps provider plugins free of persistence, transport entrypoints, and queue runtime', () => {
    if (!existsSync(resolve(srcRoot, 'mail-channel'))) return;
    const forbiddenFragments = ['/db/', '/routes/', '/trpc/'];
    const violations = importsBelow('mail-channel').filter(
      ({ specifier, target }) =>
        specifier === 'cloudflare:workers' ||
        (target !== null &&
          forbiddenFragments.some((fragment) => `/${target}/`.includes(fragment))),
    );

    expect(violations).toEqual([]);
  });

  it('keeps generic sync and Nango integration code independent from Gmail', () => {
    const roots = [
      'modules/mail-sync/domain',
      'modules/mail-sync/application',
      'integrations/nango',
    ].filter((root) => existsSync(resolve(srcRoot, root)));
    const violations = roots
      .flatMap(importsBelow)
      .filter(({ target }) => target?.includes('mail-channel/gmail'));

    expect(violations).toEqual([]);
  });

  it('keeps canonical outbound independent from legacy queues, KV, and providers', () => {
    const violations = importsBelow('modules/mail-outbound').filter(
      ({ specifier, target }) =>
        specifier === 'cloudflare:workers' ||
        target?.includes('mail-channel/gmail') ||
        target?.includes('lib/driver') ||
        target?.includes('pipelines'),
    );
    const legacyBindingMentions = collectTypeScriptFiles(resolve(srcRoot, 'modules/mail-outbound'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('KVNamespace') || source.includes('send_email_queue');
      })
      .map((file) => normalizePath(relative(srcRoot, file)));

    expect(violations).toEqual([]);
    expect(legacyBindingMentions).toEqual([]);
  });

  it('keeps routes and tRPC independent from provider SDKs and the raw Nango client', () => {
    const violations = ['routes', 'trpc']
      .flatMap(importsBelow)
      .filter(
        ({ specifier, target }) =>
          specifier === '@googleapis/gmail' || target?.includes('integrations/nango/client'),
      );

    expect(violations).toEqual([]);
  });
});
