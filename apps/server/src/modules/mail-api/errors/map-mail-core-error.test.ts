import { MailCoreError } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { mapMailCoreError } from './map-mail-core-error';

describe('mapMailCoreError', () => {
  it('maps cross-account references to public NOT_FOUND without entity details', () => {
    expect(
      mapMailCoreError(new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: 'foreign' }), {
        requestId: 'request-1',
      }),
    ).toMatchObject({
      code: 'NOT_FOUND',
      retryable: false,
      requestId: 'request-1',
    });
  });

  it.each([
    ['DRAFT_REVISION_CONFLICT', 'REVISION_MISMATCH', false],
    ['OVER_QUOTA', 'OVER_QUOTA', false],
    ['BLOB_STORE_FAILURE', 'STORAGE_FAILURE', true],
    ['STORAGE_FAILURE', 'STORAGE_FAILURE', true],
    ['INVALID_CURSOR', 'INVALID_CURSOR', false],
  ] as const)('maps %s to %s', (coreCode, apiCode, retryable) => {
    expect(mapMailCoreError(new MailCoreError(coreCode), { requestId: 'request-2' })).toMatchObject(
      {
        code: apiCode,
        retryable,
        requestId: 'request-2',
      },
    );
  });

  it('maps unknown errors to a retryable storage failure without leaking the message', () => {
    const mapped = mapMailCoreError(new Error('password=secret'), { requestId: 'request-3' });
    expect(mapped).toMatchObject({
      code: 'STORAGE_FAILURE',
      retryable: true,
      requestId: 'request-3',
    });
    expect(mapped.message).not.toContain('secret');
  });
});
