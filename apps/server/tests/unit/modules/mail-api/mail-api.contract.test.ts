import { describe, expect, it } from 'vitest';

import { mailApiRouter } from '../../../../src/modules/mail-api';

describe('unified local Mail API facade', () => {
  it('exports one nested Router with every canonical resource', () => {
    expect(Object.keys(mailApiRouter._def.record)).toEqual([
      'account',
      'mailbox',
      'email',
      'thread',
      'identity',
      'submission',
      'view',
      'action',
      'crm',
    ]);
  });
});
