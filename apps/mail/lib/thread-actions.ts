import { FOLDERS } from '@/lib/utils';

export type ThreadDestination = 'inbox' | 'archive' | 'spam' | 'bin' | 'snoozed' | null;
export type FolderLocation = 'inbox' | 'archive' | 'spam' | 'sent' | 'bin' | string;

export interface MoveThreadOptions {
  threadIds: string[];
  currentFolder: FolderLocation;
  destination: ThreadDestination;
}

export function isActionAvailable(folder: FolderLocation, action: ThreadDestination): boolean {
  if (!action) return false;

  const pattern = `${folder}_to_${action}`;

  switch (pattern) {
    case `${FOLDERS.INBOX}_to_spam`:
    case `${FOLDERS.INBOX}_to_archive`:
    case `${FOLDERS.INBOX}_to_bin`:
    case `${FOLDERS.ARCHIVE}_to_inbox`:
    case `${FOLDERS.ARCHIVE}_to_bin`:
    case `${FOLDERS.SPAM}_to_inbox`:
    case `${FOLDERS.SPAM}_to_bin`:
      return true;
    default:
      return false;
  }
}

export function getAvailableActions(folder: FolderLocation): ThreadDestination[] {
  const allPossibleActions: ThreadDestination[] = ['inbox', 'archive', 'spam', 'bin', 'snoozed'];
  return allPossibleActions.filter((action) => isActionAvailable(folder, action));
}
