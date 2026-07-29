import { describe, expect, it } from 'vitest';

import {
  createImapCheckpoint,
  parseImapCheckpoint,
  parseImapRemoteMessageId,
  toImapRemoteMessageId,
} from '../../../../../src/mail-channel/imap-smtp/inbound/checkpoint';

describe('IMAP checkpoint', () => {
  it('stores UIDVALIDITY, the next unseen UID, MODSEQ, and last successful time', () => {
    expect(
      createImapCheckpoint({
        uidValidity: '123',
        nextUid: 200,
        highestModseq: '900',
        lastSuccessfulAt: new Date('2026-07-28T12:00:00.000Z'),
      }),
    ).toEqual({
      version: 1,
      mailbox: 'INBOX',
      uidValidity: '123',
      nextUid: 200,
      highestModseq: '900',
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
    });
  });

  it('rejects malformed checkpoints and round-trips a UIDVALIDITY-qualified remote ID', () => {
    expect(() =>
      parseImapCheckpoint({
        version: 1,
        mailbox: 'INBOX',
        uidValidity: '0',
        nextUid: 1,
        highestModseq: null,
        lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
      }),
    ).toThrow('IMAP_INVALID_CHECKPOINT');

    const remoteId = toImapRemoteMessageId('123', 456);
    expect(remoteId).toBe('123:456');
    expect(parseImapRemoteMessageId(remoteId)).toEqual({
      uidValidity: '123',
      uid: 456,
    });
  });
});
