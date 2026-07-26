export const normalizeMailboxEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Mailbox email is required');
  }
  return normalized;
};
