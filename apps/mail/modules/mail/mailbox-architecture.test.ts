import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const mailRoot = resolve(import.meta.dirname, '../..');
const sourceRoots = ['app', 'components', 'config', 'hooks', 'modules', 'providers'];
const ignoredFile = resolve(import.meta.filename);

const sourceFiles = sourceRoots.flatMap((sourceRoot) => {
  const root = resolve(mailRoot, sourceRoot);
  if (!existsSync(root)) return [];
  const visit = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) return visit(path);
      return /\.(ts|tsx)$/.test(name) && path !== ignoredFile ? [path] : [];
    });
  return visit(root);
});

describe('mailbox frontend architecture', () => {
  it('contains no legacy label navigation modules or provider capability branch', () => {
    const labelWord = ['lab', 'els'].join('');
    const settingsLabelDirectory = ['app/(routes)/settings', labelWord].join('/');
    const settingsLabelRoute = ['/settings', labelWord].join('/');
    const mailLabelRoute = ['/mail', 'label', ''].join('/');
    const relativePaths = sourceFiles.map((path) =>
      path.slice(mailRoot.length + 1).replaceAll('\\', '/'),
    );
    expect(relativePaths).not.toContain('components/ui/sidebar-labels.tsx');
    expect(relativePaths).not.toContain('components/ui/recursive-folder.tsx');
    expect(relativePaths).not.toContain('components/labels/label-dialog.tsx');
    expect(relativePaths).not.toContain('hooks/use-labels.ts');
    expect(relativePaths).not.toContain('hooks/use-labels-search.ts');
    expect(relativePaths.some((path) => path.startsWith(settingsLabelDirectory))).toBe(false);

    const source = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(
      new RegExp(`capabilities\\s*\\.\\s*includes\\(\\s*['"]${labelWord}['"]\\s*\\)`),
    );
    expect(source).not.toContain(settingsLabelRoute);
    expect(source).not.toContain(mailLabelRoute);
  });
});
