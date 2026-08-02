import { useMemo } from 'react';

import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import type { Label } from '@/types';

const toLabel = (mailbox: ReturnType<typeof useMailboxes>['mailboxes'][number]): Label => ({
  id: mailbox.id,
  name: mailbox.name,
  type: 'label',
  ...(mailbox.color
    ? {
        color: {
          backgroundColor: mailbox.color,
          textColor: mailbox.color,
        },
      }
    : {}),
});

export function useMailboxLabels({
  ids,
  enabled = true,
}: {
  ids?: readonly string[];
  enabled?: boolean;
} = {}) {
  const query = useMailboxes({ enabled });
  const labels = useMemo(() => {
    const selectedIds = ids ? new Set(ids) : null;
    return query.mailboxes
      .filter(
        (mailbox) =>
          mailbox.kind === 'label' && (selectedIds === null || selectedIds.has(mailbox.id)),
      )
      .toSorted(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      )
      .map(toLabel);
  }, [ids, query.mailboxes]);

  return { ...query, labels };
}
