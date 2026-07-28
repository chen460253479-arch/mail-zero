import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GMAIL_JSON_SEND_RAW_LIMIT, buildGmailSendRequest } from '../../../../../src/mail-channel/gmail/outbound/mime-request';

describe('Gmail outbound MIME request', () => {
  const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

  it.each([GMAIL_JSON_SEND_RAW_LIMIT - 1, GMAIL_JSON_SEND_RAW_LIMIT])(
    'uses base64url JSON at %i bytes without changing input',
    (size) => {
      const raw = new Uint8Array(size).fill(255);
      const before = digest(raw);
      const request = buildGmailSendRequest(raw, 'thread-1');

      expect(request).toMatchObject({
        mode: 'json',
        requestBody: { threadId: 'thread-1' },
      });
      expect(request.mode === 'json' && request.requestBody.raw).not.toMatch(/[+/=]/u);
      expect(digest(raw)).toBe(before);
    },
  );

  it('uses unchanged message/rfc822 media above the JSON threshold', () => {
    const raw = new Uint8Array(GMAIL_JSON_SEND_RAW_LIMIT + 1).fill(127);
    const request = buildGmailSendRequest(raw, 'thread-2');

    expect(request).toMatchObject({
      mode: 'upload',
      requestBody: { threadId: 'thread-2' },
      media: { mimeType: 'message/rfc822' },
    });
    expect(request.mode === 'upload' && request.media.body).toBe(raw);
  });
});
