import { describe, expect, it, vi } from 'vitest';

import {
  OptimisticActionsManager,
  settlePendingAction,
  startImmediatePendingAction,
  type PendingAction,
} from './optimistic-actions-manager';

const pendingStarAction = (id: string): PendingAction => ({
  id,
  type: 'STAR',
  threadIds: [`thread-${id}`],
  optimisticId: `optimistic-${id}`,
  params: { starred: true },
  execute: vi.fn(),
  undo: vi.fn(),
});

const addPending = (manager: OptimisticActionsManager, action: PendingAction) => {
  manager.pendingActions.set(action.id, action);
  const ids = manager.pendingActionsByType.get(action.type) ?? new Set<string>();
  ids.add(action.id);
  manager.pendingActionsByType.set(action.type, ids);
};

describe('settlePendingAction', () => {
  it('cleans a single action and requests a refresh', () => {
    const manager = new OptimisticActionsManager();
    addPending(manager, pendingStarAction('one'));

    expect(settlePendingAction(manager, 'one', 'STAR')).toEqual({ shouldRefresh: true });
    expect(manager.pendingActions.has('one')).toBe(false);
    expect(manager.pendingActionsByType.has('STAR')).toBe(false);
  });

  it('cleans only the completed action while another action of the same type is pending', () => {
    const manager = new OptimisticActionsManager();
    addPending(manager, pendingStarAction('one'));
    addPending(manager, pendingStarAction('two'));

    expect(settlePendingAction(manager, 'one', 'STAR')).toEqual({ shouldRefresh: false });
    expect(manager.pendingActions.has('one')).toBe(false);
    expect(manager.pendingActions.has('two')).toBe(true);
    expect([...manager.pendingActionsByType.get('STAR')!]).toEqual(['two']);
  });

  it('requests a refresh when the last action of a type settles', () => {
    const manager = new OptimisticActionsManager();
    addPending(manager, pendingStarAction('one'));
    addPending(manager, pendingStarAction('two'));
    settlePendingAction(manager, 'one', 'STAR');

    expect(settlePendingAction(manager, 'two', 'STAR')).toEqual({ shouldRefresh: true });
    expect(manager.pendingActionsByType.has('STAR')).toBe(false);
  });

  it('clears the global undo target when that action settles', () => {
    const manager = new OptimisticActionsManager();
    addPending(manager, pendingStarAction('one'));
    manager.lastActionId = 'one';

    settlePendingAction(manager, 'one', 'STAR');

    expect(manager.lastActionId).toBeNull();
  });
});

describe('startImmediatePendingAction', () => {
  it('starts the write before returning control and commits after it resolves', async () => {
    const events: string[] = [];
    let releaseWrite!: () => void;
    const writeBlocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const completion = startImmediatePendingAction({
      execute: async () => {
        events.push('execute');
        await writeBlocked;
      },
      onCommitted: async () => {
        events.push('committed');
      },
      onFailed: async () => {
        events.push('failed');
      },
    });

    expect(events).toEqual(['execute']);
    releaseWrite();
    await completion;
    expect(events).toEqual(['execute', 'committed']);
  });

  it('routes a synchronous write failure through the failure handler', async () => {
    const failure = new Error('write failed');
    const handled: unknown[] = [];

    await startImmediatePendingAction({
      execute: () => {
        throw failure;
      },
      onCommitted: async () => {
        throw new Error('must not commit');
      },
      onFailed: async (error) => {
        handled.push(error);
      },
    });

    expect(handled).toEqual([failure]);
  });
});
