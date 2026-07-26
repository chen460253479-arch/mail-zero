export { assertState } from './assert-state';
export { mergeMailChanges } from './merge-change';
export { recordChanges, type PendingMailChange } from './record-change';
export { getChanges, type ChangesResult, type GetChangesInput } from './get-changes';
export { getState, type GetStateInput } from './get-state';
export type {
  ChangeCollection,
  ChangeType,
  MailChange,
  MailCoreSetError,
  StateVersioned,
} from './types';
