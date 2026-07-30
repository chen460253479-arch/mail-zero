import type { Locale } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function getDateLocale(locale?: string): Locale | undefined {
  return locale === 'zh' ? zhCN : undefined;
}
