export { createMailbox } from './create-mailbox';
export { destroyMailbox } from './destroy-mailbox';
export { listMailboxes } from './list-mailboxes';
export { updateMailbox } from './update-mailbox';
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
  CreateMailboxInput,
  DestroyMailboxInput,
  ListMailboxesInput,
  UpdateMailboxInput,
} from './types';
