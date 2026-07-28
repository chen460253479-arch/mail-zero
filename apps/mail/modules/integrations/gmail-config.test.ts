import { describe, expect, it } from 'vitest';

import { defaultGmailConfigForm, getGmailConfigErrors, isManualOnly } from './gmail-config';

describe('Gmail integration form', () => {
  it('defaults to scheduled incremental sync every ten minutes', () => {
    expect(defaultGmailConfigForm).toMatchObject({
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
    });
  });

  it('reports manual-only only when Watch and scheduled sync are both disabled', () => {
    expect(
      isManualOnly({
        ...defaultGmailConfigForm,
        scheduledSyncEnabled: false,
      }),
    ).toBe(true);
    expect(isManualOnly(defaultGmailConfigForm)).toBe(false);
    expect(
      isManualOnly({
        ...defaultGmailConfigForm,
        inboxWatchEnabled: true,
        scheduledSyncEnabled: false,
      }),
    ).toBe(false);
  });

  it('requires Pub/Sub fields only while Inbox Watch is enabled', () => {
    expect(getGmailConfigErrors(defaultGmailConfigForm)).toEqual({});
    expect(
      getGmailConfigErrors({
        ...defaultGmailConfigForm,
        inboxWatchEnabled: true,
      }),
    ).toEqual({
      topicName: 'Required',
      subscriptionName: 'Required',
      pushAudience: 'Required',
      pushServiceAccount: 'Required',
    });
  });
});
