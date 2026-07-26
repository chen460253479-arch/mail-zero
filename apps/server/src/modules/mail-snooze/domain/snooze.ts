export type SnoozeStatus = 'scheduled' | 'waking' | 'completed' | 'canceled';

export type SnoozeRecord = {
  accountId: string;
  threadId: string;
  wakeAt: Date;
  restoreMailboxIds: string[];
  status: SnoozeStatus;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface MailSnoozeRepository {
  find(accountId: string, threadId: string): Promise<SnoozeRecord | null>;
  schedule(input: {
    accountId: string;
    threadId: string;
    wakeAt: Date;
    restoreMailboxIds: string[];
    now: Date;
  }): Promise<SnoozeRecord>;
  cancel(input: { accountId: string; threadId: string; now: Date }): Promise<void>;
  claimDue(input: {
    now: Date;
    limit: number;
    leaseOwner: string;
    leaseForMs: number;
  }): Promise<SnoozeRecord[]>;
  complete(input: {
    accountId: string;
    threadId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<void>;
  release(input: {
    accountId: string;
    threadId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<void>;
}
