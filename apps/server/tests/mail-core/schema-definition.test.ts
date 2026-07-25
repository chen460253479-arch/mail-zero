import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema';

describe('local mail schema', () => {
  it('exports every local mail collection', () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        'mailAccount',
        'mailbox',
        'blob',
        'thread',
        'email',
        'emailAddress',
        'emailMailbox',
        'emailTrashRestore',
        'emailKeyword',
        'emailContent',
        'emailPart',
        'mailIdentity',
        'emailSubmission',
        'submissionAttempt',
        'remoteEmail',
        'mailChange',
      ]),
    );
  });
});
