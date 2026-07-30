import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (path.includes('node_modules') || path.includes('build') || path.includes('tests')) {
      return [];
    }
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/u.test(path)
        ? [path]
        : [];
  });

describe('standard Session architecture', () => {
  it.each([
    'zero-external-session',
    'externalBrowserSession',
    'allowedNangoConnectIds',
    'ExternalAccountSwitcher',
    "mode === 'external'",
    'ctx.externalSession',
  ])('contains no legacy external Session branch: %s', (forbidden) => {
    const matches = [
      ...sourceFiles(resolve(repositoryRoot, 'apps/server/src')),
      ...sourceFiles(resolve(repositoryRoot, 'apps/mail')),
    ].filter((file) => readFileSync(file, 'utf8').includes(forbidden));

    expect(matches).toEqual([]);
  });
});
