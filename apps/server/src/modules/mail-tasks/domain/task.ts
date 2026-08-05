import {
  parseMailIngressCommand,
  type MailIngressCommand,
} from '../../mail-sync/application/commands';
import { parseMailOutboundCommand, type MailOutboundCommand } from '../../mail-outbound';
import { z } from 'zod';

const externalMailTaskCommandSchema = z
  .object({
    type: z.literal('prepare_external_mail_submission'),
    submissionId: z.string().min(1),
  })
  .strict();

export type ExternalMailTaskCommand = z.infer<typeof externalMailTaskCommandSchema>;

export class MailTaskProcessingError extends Error {
  constructor(
    public readonly code: string,
    public readonly disposition: 'permanent' | 'retryable',
    message: string = code,
  ) {
    super(message);
    this.name = 'MailTaskProcessingError';
  }
}

export type MailTaskQueue = 'ingress' | 'outbound' | 'external';
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
    }
  | {
      queue: 'external';
      command: ExternalMailTaskCommand;
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
): MailIngressCommand | MailOutboundCommand | ExternalMailTaskCommand => {
  if (task.queue === 'ingress') return parseMailIngressCommand(task.command);
  if (task.queue === 'outbound') return parseMailOutboundCommand(task.command);
  return externalMailTaskCommandSchema.parse(task.command);
};

export const parseExternalMailTaskCommand = (value: unknown): ExternalMailTaskCommand =>
  externalMailTaskCommandSchema.parse(value);
