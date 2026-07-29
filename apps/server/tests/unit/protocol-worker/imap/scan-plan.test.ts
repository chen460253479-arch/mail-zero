import { describe, expect, it } from 'vitest';

import {
  createImapScanPlan,
  nextImapPageCursor,
} from '../../../../src/protocol-worker/imap/scan-plan';

describe('IMAP protocol Worker scan planning', () => {
  it('pins a normal incremental scan to the binding UID boundary', () => {
    expect(
      createImapScanPlan({
        actualUidValidity: '123',
        actualUidNext: 205,
        expectedUidValidity: '123',
        nextUid: 200,
        lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
        cursor: null,
      }),
    ).toEqual({
      mode: 'uid',
      uidValidity: '123',
      nextUid: 200,
      upperUid: 204,
    });
  });

  it('uses a bounded recovery window when UIDVALIDITY changes', () => {
    expect(
      createImapScanPlan({
        actualUidValidity: '456',
        actualUidNext: 20,
        expectedUidValidity: '123',
        nextUid: 200,
        lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
        cursor: null,
      }),
    ).toEqual({
      mode: 'recovery',
      uidValidity: '456',
      nextUid: 1,
      upperUid: 19,
      receivedSince: '2026-07-28T11:55:00.000Z',
    });
  });

  it('discards a stale page cursor after another UIDVALIDITY reset', () => {
    expect(
      createImapScanPlan({
        actualUidValidity: '789',
        actualUidNext: 5,
        expectedUidValidity: '123',
        nextUid: 200,
        lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
        cursor: {
          mode: 'recovery',
          uidValidity: '456',
          nextUid: 10,
          upperUid: 19,
          receivedSince: '2026-07-28T11:55:00.000Z',
        },
      }),
    ).toMatchObject({
      uidValidity: '789',
      nextUid: 1,
      upperUid: 4,
    });
  });

  it('continues from the last returned UID without moving the upper boundary', () => {
    expect(
      nextImapPageCursor(
        {
          mode: 'uid',
          uidValidity: '123',
          nextUid: 200,
          upperUid: 300,
        },
        [200, 202],
        2,
      ),
    ).toEqual({
      mode: 'uid',
      uidValidity: '123',
      nextUid: 203,
      upperUid: 300,
    });
    expect(
      nextImapPageCursor(
        {
          mode: 'uid',
          uidValidity: '123',
          nextUid: 299,
          upperUid: 300,
        },
        [299, 300],
        2,
      ),
    ).toBeNull();
  });
});
