import type { MailAccountId, MailboxId, MailboxKind, MailboxRole } from '../types';

export type CreateMailboxInput = {
  accountId: MailAccountId;
  name: string;
  kind: MailboxKind;
  role: MailboxRole | null;
  parentId: MailboxId | null;
};

export type UpdateMailboxInput = {
  accountId: MailAccountId;
  mailboxId: MailboxId;
  name?: string;
  parentId?: MailboxId | null;
  role?: MailboxRole | null;
  color?: string | null;
  sortOrder?: number;
  isSubscribed?: boolean;
};

export type DestroyMailboxInput = {
  accountId: MailAccountId;
  mailboxId: MailboxId;
};

export type ListMailboxesInput = {
  accountId: MailAccountId;
};

export type CreateMailboxData = Omit<CreateMailboxInput, 'accountId'>;
export type UpdateMailboxPatch = Omit<UpdateMailboxInput, 'accountId' | 'mailboxId'>;
