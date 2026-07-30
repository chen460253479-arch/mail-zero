import { buildMailboxStats } from '@/modules/mail/adapters/mailbox-view';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';

export const useStats = () => {
  const query = useMailboxes();
  return {
    ...query,
    data: buildMailboxStats(query.mailboxes),
  };
};
