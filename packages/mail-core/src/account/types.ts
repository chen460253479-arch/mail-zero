import type { IdentityId, MailAccountId } from '../types';

export type CreateMailAccountInput = {
  userId: string;
  connectionId: string;
  timezone: string;
  storageQuotaBytes: bigint | null;
};

export type CreateIdentityInput = {
  accountId: MailAccountId;
  name: string | null;
  email: string;
  replyTo: string | null;
  makeDefault: boolean;
};

export type UpdateIdentityInput = {
  accountId: MailAccountId;
  identityId: IdentityId;
  name?: string | null;
  email?: string;
  replyTo?: string | null;
  makeDefault?: boolean;
};

export type DestroyIdentityInput = {
  accountId: MailAccountId;
  identityId: IdentityId;
};
