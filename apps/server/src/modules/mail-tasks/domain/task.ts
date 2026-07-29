import {
  parseMailIngressCommand,
  type MailIngressCommand,
} from '../../mail-sync/application/commands';
import { parseMailOutboundCommand, type MailOutboundCommand } from '../../mail-outbound';

export type MailTaskQueue = 'ingress' | 'outbound';
export type MailTaskStatus = 'ready' | 'running' | 'retry' | 'dead';

export type EnqueueMailTaskInput =
  | {
      queue: 'ingress';
      command: MailIngressCommand;
      dedupeKey: string;
      runAt?: Date;
      maxAttempts?: number;
    }
  | {
      queue: 'outbound';
      command: MailOutboundCommand;
      dedupeKey: string;
      runAt?: Date;
      maxAttempts?: number;
    };

export type ClaimedMailTask = {
  id: string;
  queue: MailTaskQueue;
  command: unknown;
  attempts: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
};

export interface MailTaskRepository {
  enqueue(input: EnqueueMailTaskInput): Promise<{ id: string; created: boolean }>;
  claim(input: {
    owner: string;
    queues: MailTaskQueue[];
    now: Date;
    limit: number;
    leaseForMs: number;
  }): Promise<ClaimedMailTask[]>;
  complete(input: { id: string; owner: string; now: Date }): Promise<boolean>;
  retry(input: {
    id: string;
    owner: string;
    now: Date;
    runAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<'retry' | 'dead' | 'lost'>;
  failPermanently(input: {
    id: string;
    owner: string;
    now: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<boolean>;
  recoverExpired(input: { now: Date; limit: number }): Promise<number>;
}

export const parseClaimedMailTaskCommand = (
  task: ClaimedMailTask,
): MailIngressCommand | MailOutboundCommand =>
  task.queue === 'ingress'
    ? parseMailIngressCommand(task.command)
    : parseMailOutboundCommand(task.command);
