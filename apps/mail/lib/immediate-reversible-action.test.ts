import { describe, expect, it } from 'vitest';

import { KeyedActionQueue, startImmediateReversibleAction } from './immediate-reversible-action';

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createCallbacks = (events: string[]) => ({
  onUndoRequested: () => events.push('undo-requested'),
  onCommitted: async () => {
    events.push('committed');
  },
  onForwardFailed: async () => {
    events.push('forward-failed');
  },
  onReverted: async () => {
    events.push('reverted');
  },
  onRevertFailed: async () => {
    events.push('revert-failed');
  },
});

describe('startImmediateReversibleAction', () => {
  it('starts the forward operation immediately and commits when finalized', async () => {
    const events: string[] = [];

    const action = startImmediateReversibleAction({
      queue: new KeyedActionQueue(),
      key: 'account-1:$important',
      execute: async () => {
        events.push('execute');
      },
      revert: async () => {
        events.push('revert');
      },
      ...createCallbacks(events),
    });

    expect(events).toEqual(['execute']);

    await action.finalize();

    expect(events).toEqual(['execute', 'committed']);
  });

  it('submits the reverse operation after a successful forward operation', async () => {
    const events: string[] = [];

    const action = startImmediateReversibleAction({
      queue: new KeyedActionQueue(),
      key: 'account-1:$flagged',
      execute: async () => {
        events.push('execute');
      },
      revert: async () => {
        events.push('revert');
      },
      ...createCallbacks(events),
    });

    await action.undo();

    expect(events).toEqual(['execute', 'undo-requested', 'revert', 'reverted']);
  });

  it('waits for an in-flight forward operation before submitting the reverse operation', async () => {
    const events: string[] = [];
    const forward = deferred<void>();

    const action = startImmediateReversibleAction({
      queue: new KeyedActionQueue(),
      key: 'account-1:$important',
      execute: async () => {
        events.push('execute');
        await forward.promise;
        events.push('execute-finished');
      },
      revert: async () => {
        events.push('revert');
      },
      ...createCallbacks(events),
    });

    const undoPromise = action.undo();
    expect(events).toEqual(['execute', 'undo-requested']);

    forward.resolve();
    await undoPromise;

    expect(events).toEqual(['execute', 'undo-requested', 'execute-finished', 'revert', 'reverted']);
  });

  it('does not submit a reverse operation when the forward operation fails', async () => {
    const events: string[] = [];

    const action = startImmediateReversibleAction({
      queue: new KeyedActionQueue(),
      key: 'account-1:$important',
      execute: async () => {
        events.push('execute');
        throw new Error('forward failed');
      },
      revert: async () => {
        events.push('revert');
      },
      ...createCallbacks(events),
    });

    await action.undo();

    expect(events).toEqual(['execute', 'undo-requested', 'forward-failed']);
  });

  it('reports a failed reverse operation without reporting a successful revert', async () => {
    const events: string[] = [];

    const action = startImmediateReversibleAction({
      queue: new KeyedActionQueue(),
      key: 'account-1:$flagged',
      execute: async () => {
        events.push('execute');
      },
      revert: async () => {
        events.push('revert');
        throw new Error('revert failed');
      },
      ...createCallbacks(events),
    });

    await action.undo();

    expect(events).toEqual(['execute', 'undo-requested', 'revert', 'revert-failed']);
  });
});

describe('KeyedActionQueue', () => {
  it('runs operations with the same key in submission order', async () => {
    const events: string[] = [];
    const first = deferred<void>();
    const queue = new KeyedActionQueue();

    const firstResult = queue.enqueue('account-1:$important', async () => {
      events.push('first-started');
      await first.promise;
      events.push('first-finished');
    });
    const secondResult = queue.enqueue('account-1:$important', async () => {
      events.push('second-started');
    });

    expect(events).toEqual(['first-started']);

    first.resolve();
    await Promise.all([firstResult, secondResult]);

    expect(events).toEqual(['first-started', 'first-finished', 'second-started']);
  });
});
