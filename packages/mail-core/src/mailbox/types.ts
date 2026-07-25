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
};

export type DestroyMailboxInput = {
  accountId: MailAccountId;
  mailboxId: MailboxId;
};

export type ListMailboxesInput = {
  accountId: MailAccountId;
};
