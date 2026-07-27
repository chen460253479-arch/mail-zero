export type MailIdentity = {
  id: string;
  name: string | null;
  email: string;
  replyTo: string | null;
  isDefault: boolean;
};
