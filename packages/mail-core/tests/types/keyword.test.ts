import { describe, expect, it } from 'vitest';

import { normalizeKeyword } from '../../src';

describe('mail-core vocabulary', () => {
  it('normalizes standard JMAP keywords', () => {
    expect(normalizeKeyword('$SEEN')).toBe('$seen');
    expect(normalizeKeyword('$Draft')).toBe('$draft');
  });

  it('rejects whitespace and control characters in keywords', () => {
    expect(() => normalizeKeyword('team label')).toThrow('INVALID_KEYWORD');
    expect(() => normalizeKeyword('team\nlabel')).toThrow('INVALID_KEYWORD');
    expect(() => normalizeKeyword('team\u009Blabel')).toThrow('INVALID_KEYWORD');
  });
});
