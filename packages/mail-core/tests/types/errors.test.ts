import { describe, expect, it } from 'vitest';

import { MailCoreError } from '../../src';

describe('MailCoreError', () => {
  it('exposes a safe stable error shape', () => {
    const error = new MailCoreError('EMAIL_NOT_FOUND', { entityId: 'email-1' });

    expect(error.code).toBe('EMAIL_NOT_FOUND');
    expect(error.details).toEqual({ entityId: 'email-1' });
    expect(JSON.stringify(error)).not.toContain('rawMime');
  });

  it('retains only allowlisted error details', () => {
    const error = new MailCoreError('EMAIL_NOT_FOUND', {
      entityId: 'email-1',
      accessToken: 'oauth-access-token',
      rawMime: 'Subject: private message',
      body: 'private message body',
      signedUrl: 'https://example.com/blob?signature=private-signature',
    });

    expect(error.details).toEqual({ entityId: 'email-1' });
    expect(JSON.stringify(error)).not.toContain('oauth-access-token');
    expect(JSON.stringify(error)).not.toContain('private message');
    expect(JSON.stringify(error)).not.toContain('private-signature');
  });
});
