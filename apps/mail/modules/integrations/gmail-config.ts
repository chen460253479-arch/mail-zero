export type GmailConfigForm = {
  authSource: 'zero_oauth' | 'nango';
  inboxWatchEnabled: boolean;
  scheduledSyncEnabled: boolean;
  syncIntervalMinutes: number;
  topicName: string;
  subscriptionName: string;
  pushAudience: string;
  pushServiceAccount: string;
};

export const defaultGmailConfigForm: GmailConfigForm = {
  authSource: 'zero_oauth',
  inboxWatchEnabled: false,
  scheduledSyncEnabled: true,
  syncIntervalMinutes: 10,
  topicName: '',
  subscriptionName: '',
  pushAudience: '',
  pushServiceAccount: '',
};

export const isManualOnly = (form: GmailConfigForm): boolean =>
  !form.inboxWatchEnabled && !form.scheduledSyncEnabled;

export const getGmailConfigErrors = (
  form: GmailConfigForm,
): Partial<Record<keyof GmailConfigForm, string>> => {
  const errors: Partial<Record<keyof GmailConfigForm, string>> = {};
  if (
    !Number.isSafeInteger(form.syncIntervalMinutes) ||
    form.syncIntervalMinutes < 1 ||
    form.syncIntervalMinutes > 1440
  ) {
    errors.syncIntervalMinutes = 'Enter a value from 1 to 1440';
  }
  if (form.inboxWatchEnabled) {
    for (const key of [
      'topicName',
      'subscriptionName',
      'pushAudience',
      'pushServiceAccount',
    ] as const) {
      if (form[key].trim().length === 0) errors[key] = 'Required';
    }
  }
  return errors;
};
