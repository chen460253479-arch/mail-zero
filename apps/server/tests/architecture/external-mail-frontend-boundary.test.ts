import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const mailRoot = resolve(import.meta.dirname, '../../../mail');

const source = (relativePath: string) => readFileSync(resolve(mailRoot, relativePath), 'utf8');

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (path.includes('node_modules') || path.includes('build')) {
      return [];
    }
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/u.test(path)
        ? [path]
        : [];
  });

describe('external mail frontend boundary', () => {
  it('never references the fixed integration API token', () => {
    const matches = sourceFiles(mailRoot).filter((file) =>
      readFileSync(file, 'utf8').includes('INTEGRATION_API_TOKEN'),
    );
    expect(matches).toEqual([]);
  });

  it('does not persist or read a launch code in browser source', () => {
    const externalAccess = sourceFiles(resolve(mailRoot, 'modules/external-access'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(externalAccess).not.toMatch(/launchCode/u);
    expect(externalAccess).not.toMatch(/localStorage|sessionStorage/u);
  });

  it('keeps settings and connection management out of external mode', () => {
    const sidebar = source('components/ui/app-sidebar.tsx');
    const mail = source('components/mail/mail.tsx');
    const settings = source('app/(routes)/settings/layout.tsx');

    expect(sidebar).toContain("access.mode === 'external'");
    expect(sidebar).toContain("access.mode !== 'external'");
    expect(mail).toContain("access.mode !== 'external'");
    expect(settings).toContain("throw redirect('/mail/inbox')");
  });

  it('leaves mail route authentication to the external-aware parent boundary', () => {
    const nestedMailRoutes = [
      source('app/(routes)/mail/[folder]/page.tsx'),
      source('app/(routes)/mail/compose/page.tsx'),
      source('app/(routes)/mail/create/page.tsx'),
    ].join('\n');

    expect(nestedMailRoutes).not.toContain('authProxy.api.getSession');
    expect(nestedMailRoutes).not.toContain('/login');
  });
});
