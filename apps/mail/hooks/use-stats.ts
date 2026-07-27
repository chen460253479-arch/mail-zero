import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';

export const useStats = () => {
  const query = useMailboxes();
  return {
    ...query,
    data: query.mailboxes.map((mailbox) => ({
      label: mailbox.role ?? mailbox.name,
      count: mailbox.unreadThreads,
    })),
  };
};
