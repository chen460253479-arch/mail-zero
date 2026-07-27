export type MailboxKind = 'system' | 'folder' | 'label';

export type MailboxRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'junk'
  | 'archive'
  | 'outbox'
  | 'scheduled';

export type Mailbox = {
  id: string;
  parentId: string | null;
  name: string;
  kind: MailboxKind;
  role: MailboxRole | null;
  color: string | null;
  sortOrder: number;
  isSubscribed: boolean;
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
};
