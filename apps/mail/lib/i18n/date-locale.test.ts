import { zhCN } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';

import { getDateLocale } from './date-locale';

describe('getDateLocale', () => {
  it('maps the Simplified Chinese Paraglide locale to the date-fns locale', () => {
    expect(getDateLocale('zh')).toBe(zhCN);
  });

  it.each([
    ['en', 'English'],
    [undefined, 'an omitted locale'],
    ['fr', 'an unsupported locale'],
  ])('keeps the date-fns default for %s', (locale, _description) => {
    expect(getDateLocale(locale)).toBeUndefined();
  });
});
