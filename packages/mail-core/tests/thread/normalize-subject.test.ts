import { describe, expect, it } from 'vitest';

import { normalizeMessageId, normalizeSubject } from '../../src';

describe('thread normalization', () => {
  it.each([
    ['Re: Hello', 'hello'],
    ['Fwd: Re:  Hello ', 'hello'],
    ['[List] Re: Hello', 'hello'],
    [' [Team] [Release] FW: RE: Cafe\u0301   Notes ', 'café notes'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });

  it.each([
    [' <Local.Part@EXAMPLE.COM> ', 'Local.Part@example.com'],
    ['<local@Example.COM>', 'local@example.com'],
    ['<<id@EXAMPLE.COM>>', '<id@example.com>'],
    ['NoDomainId', 'NoDomainId'],
  ])('normalizes message ID %s to %s', (input, expected) => {
    expect(normalizeMessageId(input)).toBe(expected);
  });
});
