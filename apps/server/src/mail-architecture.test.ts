import { dirname, extname, relative, resolve, sep } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const srcRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(srcRoot, '../../..');

const canonicalRoots = [
  'modules/mail',
  'modules/mail-accounts',
  'modules/mail-sync',
  'modules/mail-outbound',
  'modules/mail-api',
  'modules/mail-snooze',
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
  it('contains no retired remote-mail source trees', () => {
    const retiredPaths = [
      'lib/driver',
      'lib/mail-channel',
      'lib/factories',
      'lib/bulk-delete.ts',
    ];

    expect(retiredPaths.filter((path) => existsSync(resolve(srcRoot, path)))).toEqual([]);
  });

  it('contains no retired mail Queue or KV bindings in runtime configuration', () => {
    const retiredBindings = [
      'subscribe_queue',
      'send_email_queue',
      'thread_queue',
      'gmail_history_id',
      'gmail_processing_threads',
      'gmail_sub_age',
      'subscribed_accounts',
      'connection_labels',
      'pending_emails_status',
      'pending_emails_payload',
      'scheduled_emails',
      'snoozed_emails',
      'prompts_storage',
    ];
    const configurationFiles = [
      resolve(srcRoot, 'env.ts'),
      resolve(srcRoot, '../wrangler.jsonc'),
      resolve(srcRoot, '../worker-configuration.d.ts'),
      resolve(srcRoot, '../../../compose.yaml'),
    ].filter(existsSync);
    const violations = configurationFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return retiredBindings
        .filter((binding) => source.includes(binding))
        .map((binding) => `${normalizePath(relative(srcRoot, file))}:${binding}`);
    });

    expect(violations).toEqual([]);
  });

  it('declares only the fresh ZeroDB Durable Object baseline', () => {
    const source = readFileSync(resolve(srcRoot, '../wrangler.jsonc'), 'utf8');
    const retiredClasses = [
      'DurableMailbox',
      'ZeroAgent',
      'ZeroMCP',
      'ZeroDriver',
      'ThinkingMCP',
      'WorkflowRunner',
      'ThreadSyncWorker',
      'ShardRegistry',
    ];
    const forbiddenDirectives = ['"new_classes"', '"deleted_classes"'];

    expect(
      retiredClasses
        .filter((className) => source.includes(className))
        .map((className) => `wrangler.jsonc:${className}`),
    ).toEqual([]);
    expect(forbiddenDirectives.filter((directive) => source.includes(directive))).toEqual([]);
    expect(source.match(/"migrations":/gu)).toHaveLength(3);
    expect(source.match(/"tag": "v1"/gu)).toHaveLength(3);
    expect(source.match(/"new_sqlite_classes": \["ZeroDB"\]/gu)).toHaveLength(3);
  });

  it('contains no retired Agent runtime records in the workspace lockfile', () => {
    const source = readFileSync(resolve(repositoryRoot, 'pnpm-lock.yaml'), 'utf8');
    const retiredPackageRecords = [
      "'@ai-sdk/",
      "'@elevenlabs/",
      'agents@0.0.',
      'ai@4.3.16',
      'dormroom@1.0.1',
      'hono-agents@0.0.83',
      'hono-party@0.0.12',
      'partyserver@0.0.',
      'partysocket@1.1.4',
      'twilio@5.7.0',
    ];

    expect(retiredPackageRecords.filter((record) => source.includes(record))).toEqual([]);
  });

  it('keeps every canonical mail module in its declared root', () => {
    const missing = canonicalRoots.filter((root) => !existsSync(resolve(srcRoot, root)));
    expect(missing).toEqual([]);
  });

  it('prevents canonical mail modules from importing the retired remote-mail implementation', () => {
    const forbiddenFragments = [
      'lib/driver',
      'lib/brain',
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

  it('keeps the public Mail API independent from provider and credential implementations', () => {
    const forbidden = [
      'mail-channel',
      'integrations/nango',
      'mail-accounts/credentials',
      'lib/driver',
      '/gmail',
    ];
    const violations = importsBelow('modules/mail-api').filter(({ target }) =>
      target === null ? false : forbidden.some((fragment) => target.includes(fragment)),
    );
    expect(violations).toEqual([]);
  });

  it('prevents server code from importing Mail API internals instead of its facade', () => {
    const violations = collectTypeScriptFiles(srcRoot)
      .filter((file) => !normalizePath(relative(srcRoot, file)).startsWith('modules/mail-api/'))
      .flatMap((file) =>
        readImports(file).map((specifier) => ({
          file: normalizePath(relative(srcRoot, file)),
          target: resolveLocalImport(file, specifier),
        })),
      )
      .filter(
        ({ target }) =>
          target?.startsWith('modules/mail-api/') && !target.endsWith('modules/mail-api'),
      );
    expect(violations).toEqual([]);
  });

  it('keeps mailbox binding routes independent from the retired subscription queue', () => {
    const entrypoints = ['routes/integrations.ts', 'trpc/routes/connections.ts'];
    const violations = entrypoints.filter((file) =>
      readFileSync(resolve(srcRoot, file), 'utf8').includes('subscribe_queue'),
    );

    expect(violations).toEqual([]);
  });
});
