import { buildLabelView } from '@/modules/mail/adapters/mailbox-view';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { useMemo } from 'react';

export function useLabels({ enabled = true }: { enabled?: boolean } = {}) {
  const mailboxQuery = useMailboxes({ enabled });
  const { userLabels, systemLabels } = useMemo(
    () => buildLabelView(mailboxQuery.mailboxes),
    [mailboxQuery.mailboxes],
  );

  return { ...mailboxQuery, userLabels, systemLabels };
}

export function useThreadLabels(ids: string[]) {
  const { userLabels: labels = [] } = useLabels();

  const threadLabels = useMemo(() => {
    if (!labels) return [];
    return labels.filter((label) => (label.id ? ids.includes(label.id) : false));
  }, [labels, ids]);

  return { labels: threadLabels };
}
