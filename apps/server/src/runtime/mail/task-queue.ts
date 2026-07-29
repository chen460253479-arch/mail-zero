import {
  createPostgresMailTaskRepository,
  type MailTaskRepository,
} from '../../modules/mail-tasks';
import type { MailIngressCommand } from '../../modules/mail-sync/application/commands';
import type { MailOutboundCommand } from '../../modules/mail-outbound';
import type { DB } from '../../db';
import { ulid } from 'ulid';

export type MailTaskQueuePort = {
  enqueueIngress(command: MailIngressCommand): Promise<void>;
  enqueueOutbound(command: MailOutboundCommand): Promise<void>;
  notify(): void;
};

const ingressDedupeKey = (command: MailIngressCommand): string =>
  command.type === 'signal'
    ? `ingress:signal:${command.provider}:${command.externalAccount}:${command.cursorHint ?? ''}`
    : `ingress:${command.type}:${command.syncId}`;

const outboundDedupeKey = (command: MailOutboundCommand): string =>
  command.type === 'dispatch'
    ? 'outbound:dispatch'
    : `outbound:${command.type}:${command.deliveryId}`;

export const createMailTaskQueuePort = (
  repository: MailTaskRepository,
  notify: () => void,
): MailTaskQueuePort => {
  const persist = async (input: Parameters<MailTaskRepository['enqueue']>[0]): Promise<void> => {
    await repository.enqueue(input);
    notify();
  };

  return {
    enqueueIngress: async (command) =>
      await persist({
        queue: 'ingress',
        command,
        dedupeKey: ingressDedupeKey(command),
      }),

    enqueueOutbound: async (command) =>
      await persist({
        queue: 'outbound',
        command,
        dedupeKey: outboundDedupeKey(command),
      }),

    notify,
  };
};

export const createMailTaskQueuePortForDatabase = (
  db: DB,
  notify: () => void = () => undefined,
): MailTaskQueuePort =>
  createMailTaskQueuePort(
    createPostgresMailTaskRepository(db, {
      nextId: () => ulid(),
    }),
    notify,
  );
