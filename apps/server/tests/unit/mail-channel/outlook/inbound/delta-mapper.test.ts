import { describe, expect, it } from 'vitest';

import { mapOutlookDeltaMessages } from '../../../../../src/mail-channel/outlook/inbound/delta-mapper';

describe('Outlook delta mapper', () => {
  it('keeps only unique created messages and ignores removals or incomplete records', () => {
    expect(
      mapOutlookDeltaMessages([
        { id: 'message-1', conversationId: 'thread-1' },
        { id: 'message-1', conversationId: 'thread-1' },
        { id: 'removed', '@removed': { reason: 'deleted' } },
        { conversationId: 'missing-id' },
      ]),
    ).toEqual([
      {
        type: 'message_added',
        remoteMessageId: 'message-1',
        remoteThreadId: 'thread-1',
      },
    ]);
  });
});
