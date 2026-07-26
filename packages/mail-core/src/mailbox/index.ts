export { createMailbox, createMailboxInTransaction } from './create-mailbox';
export { destroyMailbox, destroyMailboxInTransaction } from './destroy-mailbox';
export { listMailboxes } from './list-mailboxes';
export {
  setMailboxes,
  type MailCoreSetError,
  type SetMailboxesInput,
  type SetMailboxesResult,
} from './set-mailboxes';
export { updateMailbox, updateMailboxInTransaction } from './update-mailbox';
export {
  calculateEmailAggregateDelta,
  type AggregateCounterDelta,
  type EmailAggregateDelta,
  type EmailAggregateProjection,
} from './email-aggregate-delta';
export {
  reconcileMailAggregates,
  type AggregateMismatch,
  type MailAggregateEntityType,
  type MailAggregateValues,
  type ReconcileMailAggregatesInput,
  type ReconcileMailAggregatesResult,
} from './reconcile-mail-aggregates';
export type {
  CreateMailboxData,
  CreateMailboxInput,
  DestroyMailboxInput,
  ListMailboxesInput,
  UpdateMailboxPatch,
  UpdateMailboxInput,
} from './types';
