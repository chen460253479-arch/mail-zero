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
  renew(
    command: Extract<MailIngressCommand, { type: 'renew' }>,
  ): Promise<{ status: 'busy' | 'renewed' | 'paused' | 'auth_error' }>;
  enqueue(command: MailIngressCommand): Promise<void>;
};

export const createMailIngressRuntime = (dependencies: {
  repository: PostgresMailSyncRepository;
  getAdapterFactory(provider: string): InboundMailAdapterFactory;
  resolveConnectionId(accountId: string): Promise<string>;
  resolveImportContext(syncId: string): Promise<ImportContext>;
  resolveSubscriptionTarget(syncId: string): Promise<VersionedProviderState>;
  mailCore: Pick<MailCore, 'importEmail'>;
  onAuthenticationError(input: {
    syncId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  enqueue(command: MailIngressCommand): Promise<void>;
  newLeaseOwner(): string;
  clock: { now(): Date };
}): MailIngressRuntime => ({
  importBatchSize: 25,
  enqueue: dependencies.enqueue,
  receiveSignal: (command) =>
    receiveInboundSignal(command, {
      recordSignal: (input) => dependencies.repository.recordSignal(input),
      enqueue: dependencies.enqueue,
    }),
  discover: (command) =>
    discoverIncremental(
      {
        syncId: command.syncId,
        owner: dependencies.newLeaseOwner(),
        leaseForMs: 120_000,
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
  renew: async (command) =>
    renewInboundSubscription(
      {
        syncId: command.syncId,
        owner: dependencies.newLeaseOwner(),
        leaseForMs: 120_000,
        subscriptionTarget: await dependencies.resolveSubscriptionTarget(command.syncId),
      },
      dependencies,
    ),
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
