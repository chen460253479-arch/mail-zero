export type Id<Kind extends string> = string & { readonly __kind: Kind };

export type MailAccountId = Id<'MailAccount'>;
export type MailboxId = Id<'Mailbox'>;
export type EmailId = Id<'Email'>;
export type ThreadId = Id<'Thread'>;
export type BlobId = Id<'Blob'>;
export type IdentityId = Id<'Identity'>;
export type EmailSubmissionId = Id<'EmailSubmission'>;
