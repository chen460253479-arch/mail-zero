import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const srcRoot = resolve(serverRoot, 'src');
const testsRoot = resolve(serverRoot, 'tests');

const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });

const isTestFile = (path: string): boolean =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) && extname(path) !== '.snap';

const normalizePath = (path: string): string => path.split(sep).join('/');

describe('server test directory layout', () => {
  it('keeps production source free of test and spec files', () => {
    expect(collectFiles(srcRoot).filter(isTestFile)).toEqual([]);
  });

  it('classifies every test artifact under an approved top-level directory', () => {
    expect(
      readdirSync(testsRoot, { withFileTypes: true })
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(['architecture', 'e2e', 'helpers', 'integration', 'unit']);
  });

  it('classifies test files according to their filename suffix', () => {
    const misclassified = collectFiles(testsRoot)
      .filter(isTestFile)
      .map((path) => normalizePath(relative(testsRoot, path)))
      .filter((path) => {
        if (path.includes('.integration.test.')) return !path.startsWith('integration/');
        if (path.includes('.e2e.test.')) return !path.startsWith('e2e/');
        return !path.startsWith('architecture/') && !path.startsWith('unit/');
      });

    expect(misclassified).toEqual([]);
  });
});
