import type { MailCore } from '@zero/mail-core';

import type { InboundMailAdapterFactory, VersionedProviderState } from '../domain/ingress-adapter';
import { importPendingMessages, type ImportContext } from '../application/import-pending';
import type { DiscoverIncrementalResult } from '../application/discover-incremental';
import type { PostgresMailSyncRepository } from '../postgres/sync-repository';
import { renewInboundSubscription } from '../application/renew-subscription';
import { discoverIncremental } from '../application/discover-incremental';
import type { ImportPendingResult } from '../application/import-pending';
import type { Logger } from '../../../infrastructure/logging/logger';
import { receiveInboundSignal } from '../application/receive-signal';
import type { MailIngressCommand } from '../application/commands';
import { MailSyncError } from '../domain/errors';

export type MailIngressRuntime = {
  importBatchSize?: number;
  logger?: Logger;
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
  logger?: Logger;
}): MailIngressRuntime => ({
  importBatchSize: 25,
  ...(dependencies.logger === undefined ? {} : { logger: dependencies.logger }),
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
        ...(dependencies.logger === undefined ? {} : { logger: dependencies.logger }),
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
  const startedAt = Date.now();
  const commonFields = {
    commandType: command.type,
    ...(command.type === 'signal' ? { provider: command.provider } : { syncId: command.syncId }),
  };
  runtime.logger?.debug('mail.sync.command.started', commonFields);
  try {
    switch (command.type) {
      case 'signal': {
        const result = await runtime.receiveSignal(command);
        runtime.logger?.info('mail.sync.signal.completed', {
          ...commonFields,
          matched: result.matched,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      case 'discover':
      case 'reconcile': {
        const result = await runtime.discover(command);
        const importQueued = result.inserted > 0;
        if (importQueued) {
          await runtime.enqueue({ type: 'import', syncId: command.syncId });
        }
        runtime.logger?.info('mail.sync.discovery.completed', {
          ...commonFields,
          status: result.status,
          inserted: result.inserted,
          importQueued,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      case 'import': {
        const result = await runtime.importPending(command);
        const batchSize = runtime.importBatchSize ?? 25;
        const nextBatchQueued = result.claimed === batchSize;
        if (nextBatchQueued) {
          await runtime.enqueue({ type: 'import', syncId: command.syncId });
        }
        runtime.logger?.info('mail.sync.import.completed', {
          ...commonFields,
          ...result,
          nextBatchQueued,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      case 'renew': {
        const result = await runtime.renew(command);
        runtime.logger?.info('mail.sync.subscription.completed', {
          ...commonFields,
          status: result.status,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  } catch (error) {
    runtime.logger?.error('mail.sync.command.failed', {
      ...commonFields,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
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
