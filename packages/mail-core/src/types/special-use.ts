export const mailboxKinds = ['system', 'folder', 'label'] as const;

export type MailboxKind = (typeof mailboxKinds)[number];

export const mailboxRoles = [
  'inbox',
  'sent',
  'drafts',
  'trash',
  'junk',
  'archive',
  'outbox',
  'scheduled',
] as const;

export type MailboxRole = (typeof mailboxRoles)[number];
