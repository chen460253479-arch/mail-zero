import { describe, expect, it } from 'vitest';

import { getFirstLetterCharacter } from './bimi-avatar';

describe('getFirstLetterCharacter', () => {
  it('uses the first Chinese character for a Chinese display name', () => {
    expect(getFirstLetterCharacter('陈泽')).toBe('陈');
  });

  it('uses an uppercase initial for Latin names and email fallbacks', () => {
    expect(getFirstLetterCharacter('chen ze')).toBe('C');
    expect(getFirstLetterCharacter('chenze@voyaseek.com')).toBe('C');
  });

  it('skips surrounding punctuation and supports non-Latin names', () => {
    expect(getFirstLetterCharacter('"Élodie"')).toBe('É');
    expect(getFirstLetterCharacter(' Александр')).toBe('А');
  });
});
