type AsyncOperation<T = void> = () => Promise<T>;

const invoke = <T>(operation: AsyncOperation<T>): Promise<T> => {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
};

export class KeyedActionQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue<T>(key: string, operation: AsyncOperation<T>): Promise<T> {
    const previous = this.tails.get(key);
    const result = previous ? previous.then(operation) : invoke(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });

    return result;
  }
}

type ImmediateReversibleActionOptions = {
  queue: KeyedActionQueue;
  key: string;
  execute: AsyncOperation;
  revert: AsyncOperation;
  onUndoRequested: () => void;
  onCommitted: AsyncOperation;
  onForwardFailed: (error: unknown) => Promise<void>;
  onReverted: AsyncOperation;
  onRevertFailed: (error: unknown) => Promise<void>;
};

type OperationOutcome = { ok: true } | { ok: false; error: unknown };

export function startImmediateReversibleAction({
  queue,
  key,
  execute,
  revert,
  onUndoRequested,
  onCommitted,
  onForwardFailed,
  onReverted,
  onRevertFailed,
}: ImmediateReversibleActionOptions) {
  let undoRequested = false;
  let undoPromise: Promise<void> | null = null;
  let finalizePromise: Promise<void> | null = null;

  const forwardOutcome: Promise<OperationOutcome> = queue.enqueue(key, execute).then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error }),
  );
  const handledForwardOutcome = forwardOutcome.then(async (outcome) => {
    if (!outcome.ok) {
      await onForwardFailed(outcome.error);
    }
    return outcome;
  });

  return {
    undo() {
      if (undoPromise) return undoPromise;

      undoRequested = true;
      onUndoRequested();
      undoPromise = (async () => {
        const outcome = await handledForwardOutcome;
        if (!outcome.ok) return;

        try {
          await queue.enqueue(key, revert);
          await onReverted();
        } catch (error) {
          await onRevertFailed(error);
        }
      })();
      return undoPromise;
    },
    finalize() {
      if (finalizePromise) return finalizePromise;

      finalizePromise = (async () => {
        const outcome = await handledForwardOutcome;
        if (outcome.ok && !undoRequested) {
          await onCommitted();
        }
      })();
      return finalizePromise;
    },
  };
}
