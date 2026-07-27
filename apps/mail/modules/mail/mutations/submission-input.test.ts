import { describe, expect, it } from 'vitest';

import { buildCancelSubmissionInput, buildSubmissionCreateInput } from './submission-input';

describe('submission input', () => {
  it('schedules ordinary send after the undo window', () => {
    expect(
      buildSubmissionCreateInput({
        accountId: 'account-1',
        clientId: 'submission-client-1',
        emailId: 'draft-1',
        identityId: 'identity-1',
        idempotencyKey: 'send-1',
        now: new Date('2026-07-27T02:00:00.000Z'),
        undoWindowMs: 10_000,
      }),
    ).toEqual({
      accountId: 'account-1',
      create: {
        'submission-client-1': {
          emailId: 'draft-1',
          identityId: 'identity-1',
          sendAt: '2026-07-27T02:00:10.000Z',
          idempotencyKey: 'send-1',
        },
      },
      destroy: [],
    });
  });

  it('keeps an explicitly scheduled future send time', () => {
    const input = buildSubmissionCreateInput({
      accountId: 'account-1',
      clientId: 'submission-client-1',
      emailId: 'draft-1',
      identityId: 'identity-1',
      idempotencyKey: 'send-1',
      now: new Date('2026-07-27T02:00:00.000Z'),
      undoWindowMs: 10_000,
      scheduleAt: '2026-07-28T02:00:00.000Z',
    });

    expect(input.create['submission-client-1']?.sendAt).toBe('2026-07-28T02:00:00.000Z');
  });

  it('cancels a scheduled submission through EmailSubmission/set destroy', () => {
    expect(
      buildCancelSubmissionInput({
        accountId: 'account-1',
        state: 'submission-state-1',
        submissionId: 'submission-1',
      }),
    ).toEqual({
      accountId: 'account-1',
      ifInState: 'submission-state-1',
      create: {},
      destroy: ['submission-1'],
    });
  });
});
