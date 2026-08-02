import type { FolderLocation, ThreadDestination } from '@/lib/thread-actions';

type ArchiveMailboxLocation = 'archive' | 'inbox';

type MoveBetweenArchiveMailboxes = (
  source: ArchiveMailboxLocation,
  destination: ArchiveMailboxLocation,
) => Promise<void>;

export function createArchiveToggleOperations({
  accountId,
  currentFolder,
  destination,
  moveBetween,
}: {
  accountId: string;
  currentFolder: FolderLocation;
  destination: ThreadDestination;
  moveBetween: MoveBetweenArchiveMailboxes;
}) {
  if (currentFolder !== 'inbox' || destination !== 'archive') {
    return null;
  }

  return {
    queueKey: `${accountId}:archive-toggle`,
    execute: () => moveBetween('inbox', 'archive'),
    revert: () => moveBetween('archive', 'inbox'),
  };
}
