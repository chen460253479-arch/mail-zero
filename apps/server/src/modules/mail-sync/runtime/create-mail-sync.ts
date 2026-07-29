import type { MailCore } from '@zero/mail-core';

import type { InboundMailAdapterFactory, VersionedProviderState } from '../domain/ingress-adapter';
import { importPendingMessages, type ImportContext } from '../application/import-pending';
import type { DiscoverIncrementalResult } from '../application/discover-incremental';
import type { PostgresMailSyncRepository } from '../postgres/sync-repository';
import { renewInboundSubscription } from '../application/renew-subscription';
import { discoverIncremental } from '../application/discover-incremental';
import type { ImportPendingResult } from '../application/import-pending';
import { receiveInboundSignal } from '../application/receive-signal';
import type { MailIngressCommand } from '../application/commands';
import { MailSyncError } from '../domain/errors';

export type MailIngressRuntime = {
  importBatchSize?: number;
  receiveSignal(
    command: Extract<MailIngressCommand, { type: 'signal' }>,
  ): Promise<{ matched: number }>;
  discover(
    command: Extract<MailIngressCommand, { type: 'discover' | 'reconcile' }>,
  ): Promise<DiscoverIncrementalResult>;
  importPending(
    command: Extract<MailIngressCommand, { type: 'import' }>,
  ): Promise<ImportPendingResult>;
  renew(command: Extract<MailIngressCommand, { type: 'renew' }>): Promise<{
    status: 'busy' | 'renewed' | 'warning' | 'disabled' | 'paused' | 'auth_error';
  }>;
  enqueue(command: MailIngressCommand): Promise<void>;
};

export const createMailIngressRuntime = (dependencies: {
  repository: PostgresMailSyncRepository;
  getAdapterFactory(provider: string): InboundMailAdapterFactory;
  resolveConnectionId(accountId: string): Promise<string>;
  resolveImportContext(syncId: string): Promise<ImportContext>;
  resolveSubscriptionTarget(syncId: string): Promise<VersionedProviderState | null>;
  mailCore: Pick<MailCore, 'importEmail'>;
  onAuthenticationError(input: {
    syncId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  enqueue(command: MailIngressCommand): Promise<void>;
  newLeaseOwner(): string;
  clock: { now(): Date };
  resolveReconcileAfterMs(syncId: string): Promise<number>;
}): MailIngressRuntime => ({
  importBatchSize: 25,
  enqueue: dependencies.enqueue,
  receiveSignal: (command) =>
    receiveInboundSignal(command, {
      recordSignal: (input) => dependencies.repository.recordSignal(input),
      enqueue: dependencies.enqueue,
    }),
  discover: async (command) =>
    await discoverIncremental(
      {
        syncId: command.syncId,
        owner: dependencies.newLeaseOwner(),
        leaseForMs: 120_000,
        reconcileAfterMs: await dependencies.resolveReconcileAfterMs(command.syncId),
      },
      dependencies,
    ),
  importPending: (command) =>
    importPendingMessages(
      {
        syncId: command.syncId,
        owner: dependencies.newLeaseOwner(),
        limit: 25,
        leaseForMs: 120_000,
        maxAttempts: 5,
        baseRetryDelayMs: 30_000,
      },
      {
        clock: dependencies.clock,
        resolveContext: dependencies.resolveImportContext,
        getAdapterFactory: dependencies.getAdapterFactory,
        repository: dependencies.repository,
        mailCore: dependencies.mailCore,
        onAuthenticationError: dependencies.onAuthenticationError,
      },
    ),
  renew: async (command) => {
    const subscriptionTarget = await dependencies.resolveSubscriptionTarget(command.syncId);
    if (subscriptionTarget === null) return { status: 'disabled' };
    return renewInboundSubscription(
      {
        syncId: command.syncId,
        owner: dependencies.newLeaseOwner(),
        leaseForMs: 120_000,
        subscriptionTarget,
      },
      dependencies,
    );
  },
});

export const processMailIngressCommand = async (
  command: MailIngressCommand,
  runtime: MailIngressRuntime,
): Promise<void> => {
  switch (command.type) {
    case 'signal':
      await runtime.receiveSignal(command);
      return;
    case 'discover':
    case 'reconcile': {
      const result = await runtime.discover(command);
      if (result.inserted > 0) {
        await runtime.enqueue({ type: 'import', syncId: command.syncId });
      }
      return;
    }
    case 'import': {
      const result = await runtime.importPending(command);
      const batchSize = runtime.importBatchSize ?? 25;
      if (result.claimed === batchSize) {
        await runtime.enqueue({ type: 'import', syncId: command.syncId });
      }
      return;
    }
    case 'renew':
      await runtime.renew(command);
  }
};

type DueDispatchRepository = Pick<
  PostgresMailSyncRepository,
  'claimDueDispatches' | 'confirmDispatch' | 'deferDispatch'
>;

export const dispatchDueMailSyncWork = async (
  input: {
    owner: string;
    limit: number;
    claimLeaseForMs: number;
    confirmedLeaseForMs: number;
    retryAfterMs: number;
    reconcileBefore: Date;
    renewalBefore: Date;
    importBefore: Date;
  },
  dependencies: {
    repository: DueDispatchRepository;
    enqueue(command: MailIngressCommand): Promise<void>;
  },
): Promise<{ reconciliations: number; renewals: number; imports: number }> => {
  const dispatches = await dependencies.repository.claimDueDispatches({
    owner: input.owner,
    limit: input.limit,
    leaseForMs: input.claimLeaseForMs,
    reconcileBefore: input.reconcileBefore,
    renewalBefore: input.renewalBefore,
    importBefore: input.importBefore,
  });
  const result = { reconciliations: 0, renewals: 0, imports: 0 };
  const errors: unknown[] = [];

  for (const dispatch of dispatches) {
    const commands: MailIngressCommand[] = [];
    if (dispatch.discover) {
      commands.push({ type: 'discover', syncId: dispatch.syncId });
    }
    if (dispatch.renew) {
      commands.push({ type: 'renew', syncId: dispatch.syncId });
    }
    if (dispatch.importPending) {
      commands.push({ type: 'import', syncId: dispatch.syncId });
    }

    try {
      for (const command of commands) {
        await dependencies.enqueue(command);
      }
      const confirmed = await dependencies.repository.confirmDispatch({
        syncId: dispatch.syncId,
        owner: input.owner,
        leaseForMs: input.confirmedLeaseForMs,
      });
      if (!confirmed) {
        throw new MailSyncError('MAIL_SYNC_DISPATCH_LEASE_LOST', 'retryable');
      }
      result.reconciliations += dispatch.discover ? 1 : 0;
      result.renewals += dispatch.renew ? 1 : 0;
      result.imports += dispatch.importPending ? 1 : 0;
    } catch (error) {
      errors.push(error);
      try {
        await dependencies.repository.deferDispatch({
          syncId: dispatch.syncId,
          owner: input.owner,
          retryAfterMs: input.retryAfterMs,
        });
      } catch (deferError) {
        errors.push(deferError);
      }
    }
  }

  if (errors.length > 0) {
    throw errors[0];
  }
  return result;
};
