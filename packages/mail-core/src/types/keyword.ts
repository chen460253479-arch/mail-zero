import { MailCoreError } from './errors';

export const standardKeywords = [
  '$seen',
  '$flagged',
  '$draft',
  '$answered',
  '$forwarded',
  '$important',
  '$junk',
] as const;

export type StandardKeyword = (typeof standardKeywords)[number];
export type Keyword = string;

const standardKeywordSet = new Set<string>(standardKeywords);
const invalidKeywordCharacter = /[\s\p{Cc}]/u;

export function normalizeKeyword(keyword: string): Keyword {
  if (
    keyword.length === 0 ||
    keyword.length > 255 ||
    invalidKeywordCharacter.test(keyword)
  ) {
    throw new MailCoreError('INVALID_KEYWORD');
  }

  const normalizedStandardKeyword = keyword.toLowerCase();

  return standardKeywordSet.has(normalizedStandardKeyword)
    ? normalizedStandardKeyword
    : keyword;
}
