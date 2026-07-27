import type { MailAccountId, MailboxId, MailCore } from '@zero/mail-core';

import type { InboundMailAdapterFactory, IngressScope } from '../domain/ingress-adapter';
import { MailSyncError } from '../domain/errors';

export type ImportContext = {
  accountId: MailAccountId;
  connectionId: string;
  provider: string;
  scope: IngressScope;
  inboxMailboxId: MailboxId;
};

type ClaimedItem = {
  id: string;
  remoteMessageId: string;
  remoteThreadId: string | null;
  attemptCount: number;
  leaseOwner: string | null;
};

type FinishInput = {
  itemId: string;
  owner: string;
  startedAt: Date;
};

type ImportRepository = {
  claimPendingItems(input: {
    syncId: string;
    owner: string;
    limit: number;
    leaseForMs: number;
  }): Promise<ClaimedItem[]>;
  markImported(input: FinishInput & { localEmailId: string }): Promise<void>;
  scheduleRetry(
    input: FinishInput & {
      nextAttemptAt: Date;
      errorCode: string;
      errorMessage: string;
    },
  ): Promise<void>;
  markFailed(
    input: FinishInput & {
      errorCode: string;
      errorMessage: string;
    },
  ): Promise<void>;
};

const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;

const requirePositiveInteger = (value: number, code: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MailSyncError(code, 'permanent');
  }
};

const safeErrorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2_000);

export type ImportPendingResult = {
  claimed: number;
  imported: number;
  retried: number;
  failed: number;
};

export const importPendingMessages = async (
  input: {
    syncId: string;
    owner: string;
    limit: number;
    leaseForMs: number;
    maxAttempts: number;
    baseRetryDelayMs: number;
  },
  dependencies: {
    clock: { now(): Date };
    resolveContext(syncId: string): Promise<ImportContext>;
    getAdapterFactory(provider: string): InboundMailAdapterFactory;
    repository: ImportRepository;
    mailCore: Pick<MailCore, 'importEmail'>;
    onAuthenticationError(input: {
      syncId: string;
      errorCode: string;
      errorMessage: string;
    }): Promise<void>;
  },
): Promise<ImportPendingResult> => {
  requirePositiveInteger(input.limit, 'MAIL_SYNC_INVALID_CLAIM_LIMIT');
  requirePositiveInteger(input.leaseForMs, 'MAIL_SYNC_INVALID_LEASE_DURATION');
  requirePositiveInteger(input.maxAttempts, 'MAIL_SYNC_INVALID_MAX_ATTEMPTS');
  requirePositiveInteger(input.baseRetryDelayMs, 'MAIL_SYNC_INVALID_RETRY_DELAY');

  const context = await dependencies.resolveContext(input.syncId);
  const adapter = await dependencies
    .getAdapterFactory(context.provider)
    .create(context.connectionId);
  if (adapter.provider !== context.provider) {
    throw new MailSyncError('MAIL_SYNC_PROVIDER_MISMATCH', 'permanent');
  }
  const items = await dependencies.repository.claimPendingItems({
    syncId: input.syncId,
    owner: input.owner,
    limit: input.limit,
    leaseForMs: input.leaseForMs,
  });
  const result: ImportPendingResult = {
    claimed: items.length,
    imported: 0,
    retried: 0,
    failed: 0,
  };

  for (const item of items) {
    if (item.leaseOwner !== input.owner) {
      throw new MailSyncError('MAIL_SYNC_ITEM_LEASE_LOST', 'retryable');
    }
    const startedAt = dependencies.clock.now();
    let localEmailId: string;
    try {
      const message = await adapter.fetchRawMessage({
        scope: context.scope,
        remoteMessageId: item.remoteMessageId,
      });
      const imported = await dependencies.mailCore.importEmail({
        accountId: context.accountId,
        provider: context.provider,
        remoteEmailId: item.remoteMessageId,
        remoteThreadId: item.remoteThreadId,
        raw: message.raw,
        mailboxIds: [context.inboxMailboxId],
        keywords: [],
        receivedAt: message.receivedAt ?? dependencies.clock.now(),
      });
      localEmailId = imported.emailId;
    } catch (error) {
      const classification = adapter.classifyError(error);
      const errorMessage = safeErrorMessage(error);
      const finish = {
        itemId: item.id,
        owner: input.owner,
        startedAt,
        errorMessage,
      };
      if (classification === 'retryable' && item.attemptCount < input.maxAttempts) {
        const delay = Math.min(
          input.baseRetryDelayMs * 2 ** (item.attemptCount - 1),
          MAX_RETRY_DELAY_MS,
        );
        await dependencies.repository.scheduleRetry({
          ...finish,
          nextAttemptAt: new Date(dependencies.clock.now().getTime() + delay),
          errorCode: 'MAIL_SYNC_IMPORT_RETRYABLE',
        });
        result.retried += 1;
        continue;
      }

      const errorCode =
        classification === 'authentication'
          ? 'MAIL_SYNC_IMPORT_AUTHENTICATION'
          : classification === 'retryable'
            ? 'MAIL_SYNC_IMPORT_ATTEMPTS_EXHAUSTED'
            : 'MAIL_SYNC_IMPORT_PERMANENT';
      if (classification === 'authentication') {
        await dependencies.repository.scheduleRetry({
          ...finish,
          nextAttemptAt: dependencies.clock.now(),
          errorCode,
        });
        await dependencies.onAuthenticationError({
          syncId: input.syncId,
          errorCode,
          errorMessage,
        });
        result.retried += 1;
        break;
      }
      await dependencies.repository.markFailed({
        ...finish,
        errorCode,
      });
      result.failed += 1;
      continue;
    }

    await dependencies.repository.markImported({
      itemId: item.id,
      owner: input.owner,
      localEmailId,
      startedAt,
    });
    result.imported += 1;
  }

  return result;
};
