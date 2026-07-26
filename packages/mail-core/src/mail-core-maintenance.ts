import { reconcileMailAggregates } from './mailbox';
import type { MailCoreDependencies } from './store';
import { garbageCollectBlobs } from './message';
import { reconcileBlobStorage } from './blob';

type BoundCommand<Command extends (...arguments_: never[]) => unknown> = (
  input: Parameters<Command>[1],
) => ReturnType<Command>;

export type MailCoreMaintenance = {
  garbageCollectBlobs: BoundCommand<typeof garbageCollectBlobs>;
  reconcileBlobStorage: BoundCommand<typeof reconcileBlobStorage>;
  reconcileMailAggregates: BoundCommand<typeof reconcileMailAggregates>;
};

export const createMailCoreMaintenance = (
  dependencies: MailCoreDependencies,
): MailCoreMaintenance => ({
  garbageCollectBlobs: (input) => garbageCollectBlobs(dependencies, input),
  reconcileBlobStorage: (input) => reconcileBlobStorage(dependencies, input),
  reconcileMailAggregates: (input) => reconcileMailAggregates(dependencies, input),
});
