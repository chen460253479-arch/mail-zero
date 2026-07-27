export type MailAccountStatus = 'active' | 'suspended' | 'deleting';

export type MailAccountCapabilities = {
  mail: boolean;
  emailSubmission: boolean;
  blobUpload: boolean;
  snooze: boolean;
};

export type MailAccount = {
  id: string;
  connectionId: string;
  status: MailAccountStatus;
  timezone: string;
  state: string;
  storageQuotaBytes: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities?: MailAccountCapabilities;
};
