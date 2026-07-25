import { describe, expect, it } from 'vitest';

import { MailCoreError } from '../../src';

describe('MailCoreError', () => {
  it('exposes a safe stable error shape', () => {
    const error = new MailCoreError('EMAIL_NOT_FOUND', { entityId: 'email-1' });

    expect(error.code).toBe('EMAIL_NOT_FOUND');
    expect(error.details).toEqual({ entityId: 'email-1' });
    expect(JSON.stringify(error)).not.toContain('rawMime');
  });
});
