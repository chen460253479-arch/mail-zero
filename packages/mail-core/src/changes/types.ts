import type { MailAccountId } from '../types';

export type ChangeCollection = 'mailbox' | 'email' | 'thread' | 'identity' | 'email_submission';

export type ChangeType = 'created' | 'updated' | 'destroyed';

export interface MailChange {
  accountId: MailAccountId;
  stateVersion: bigint;
  collection: ChangeCollection;
  entityId: string;
  changeType: ChangeType;
  changedProperties: string[] | null;
  createdAt: Date;
}

export type StateVersioned<Value> = Value & {
  stateVersion: bigint;
};
