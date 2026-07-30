import { describe, expect, it } from 'vitest';

import { locales } from '../../locales';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';
import settings from '../../project.inlang/settings.json';

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
});
