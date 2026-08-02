import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import settings from '../../project.inlang/settings.json';
import zh from '../../messages/zh.json';
import en from '../../messages/en.json';
import { locales } from '../../locales';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value) || value === null || typeof value !== 'object') {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    key === '$schema' ? [] : leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('Simplified Chinese catalog', () => {
  it('uses zh while keeping English as the default locale', () => {
    expect(settings.baseLocale).toBe('en');
    expect(settings.locales).toContain('zh');
    expect(settings.locales).not.toContain('zh-CN');
    expect(settings.locales).not.toContain('zh-TW');
    expect(locales.zh).toBe('简体中文');
  });

  it('keeps the zh catalog structurally aligned with en', () => {
    expect(leafKeys(zh).sort()).toEqual(leafKeys(en).sort());
  });

  it('keeps local mailbox UI copy in the Paraglide catalogs', () => {
    const mailRoot = resolve(import.meta.dirname, '../..');
    const localizedSources = [
      'components/mail/mail.tsx',
      'components/mailbox/label-picker.tsx',
      'components/mailbox/mailbox-delete-dialog.tsx',
      'components/mailbox/mailbox-editor-dialog.tsx',
      'components/mailbox/mailbox-settings-domain.ts',
      'components/mailbox/mailbox-settings.tsx',
      'components/mailbox/mailbox-sidebar.tsx',
      'components/mailbox/mailbox-tree-node.tsx',
      'components/mailbox/move-to-folder-menu.tsx',
      'modules/mail/mutations/mailbox-error-message.ts',
    ];

    for (const path of localizedSources) {
      expect(readFileSync(resolve(mailRoot, path), 'utf8'), path).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });
});
