import { describe, expect, it } from 'vitest';

import { appRouter } from '../../src/trpc/index';

describe('mail router cutover', () => {
  it('mounts the unified local Mail API as the only mail resource namespace', () => {
    const record = appRouter._def.record;

    expect(record).not.toHaveProperty('drafts');
    expect(record).not.toHaveProperty('labels');
    expect(Object.keys(record.mail)).toEqual([
      'account',
      'mailbox',
      'email',
      'thread',
      'identity',
      'submission',
      'view',
      'action',
    ]);
  });
});
