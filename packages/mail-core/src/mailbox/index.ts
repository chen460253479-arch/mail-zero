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
export type {
  CreateMailboxInput,
  DestroyMailboxInput,
  ListMailboxesInput,
  UpdateMailboxInput,
} from './types';
