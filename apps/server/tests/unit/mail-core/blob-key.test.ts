import { describe, expect, it } from 'vitest';

import {
  buildObjectKey,
  buildObjectPrefix,
  buildTemporaryKey,
  buildTemporaryPrefix,
  parseObjectKey,
  parseTemporaryKey,
} from '../../../src/modules/mail/blob/blob-key';
import type { BlobKind, MailAccountId } from '@zero/mail-core';

const userId = 'user-01';
const accountId = 'account-01' as MailAccountId;
const sha256 = 'ab'.repeat(32);

describe('mail blob object keys', () => {
  it.each([
    ['attachment', 'attachments'],
    ['draft_mime', 'drafts'],
    ['message_mime', 'messages'],
  ] satisfies [BlobKind, string][])('builds and parses %s keys', (kind, directory) => {
    const key = buildObjectKey(userId, accountId, kind, sha256);

    expect(key).toBe(`mail/users/${userId}/accounts/${accountId}/${directory}/sha256/ab/${sha256}`);
    expect(buildObjectPrefix(userId, accountId, kind)).toBe(
      `mail/users/${userId}/accounts/${accountId}/${directory}/sha256/`,
    );
    expect(parseObjectKey(key)).toEqual({ userId, accountId, kind, sha256 });
  });

  it('builds a categorized temporary key', () => {
    const key = buildTemporaryKey(userId, accountId, 'draft_mime');

    expect(key).toMatch(
      new RegExp(
        `^mail/users/${userId}/accounts/${accountId}/temporary/draft_mime/[a-f0-9-]{36}$`,
        'u',
      ),
    );
    expect(buildTemporaryPrefix(userId, accountId, 'draft_mime')).toBe(
      `mail/users/${userId}/accounts/${accountId}/temporary/draft_mime/`,
    );
    expect(parseTemporaryKey(key)).toEqual({ userId, accountId, kind: 'draft_mime' });
  });

  it('rejects unknown categories and unsafe identifiers', () => {
    expect(() =>
      parseObjectKey(`mail/users/${userId}/accounts/${accountId}/unknown/sha256/ab/${sha256}`),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_BLOB_KEY' }));
    expect(() => buildObjectKey('../user', accountId, 'attachment', sha256)).toThrowError(
      expect.objectContaining({ code: 'INVALID_BLOB_KEY' }),
    );
  });
});
