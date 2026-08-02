import type { ThreadDestination } from '@/lib/thread-actions';

type BasePendingAction = {
  id: string;
  type: 'MOVE' | 'STAR' | 'READ' | 'LABEL' | 'IMPORTANT' | 'SNOOZE' | 'UNSNOOZE' | 'DELETE_DRAFT';
  threadIds: string[];
  optimisticId: string;
  execute: () => Promise<void>;
  undo: () => void;
  toastId?: string | number;
};

export type PendingAction = BasePendingAction &
  (
    | { type: 'MOVE'; params: { currentFolder: string; destination: ThreadDestination } }
    | { type: 'STAR'; params: { starred: boolean } }
    | { type: 'READ'; params: { read: boolean } }
    | { type: 'LABEL'; params: { labelId: string; add: boolean } }
    | { type: 'IMPORTANT'; params: { important: boolean } }
    | { type: 'SNOOZE'; params: { currentFolder: string; wakeAt: string } }
    | { type: 'UNSNOOZE'; params: { currentFolder: string } }
    | { type: 'DELETE_DRAFT'; params: Record<string, never> }
  );

export class OptimisticActionsManager {
  pendingActions: Map<string, PendingAction> = new Map();
  pendingActionsByType: Map<string, Set<string>> = new Map();
  lastActionId: string | null = null;
}

export const settlePendingAction = (
  manager: OptimisticActionsManager,
  actionId: string,
  type: PendingAction['type'],
): { shouldRefresh: boolean } => {
  manager.pendingActions.delete(actionId);

  const typeActions = manager.pendingActionsByType.get(type);
  typeActions?.delete(actionId);

  const shouldRefresh = typeActions === undefined || typeActions.size === 0;
  if (typeActions?.size === 0) {
    manager.pendingActionsByType.delete(type);
  }

  return { shouldRefresh };
};

export const optimisticActionsManager = new OptimisticActionsManager();
