import type { EmailId, MailAccountId, MailboxId } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { importPendingMessages, type ImportContext } from './import-pending';
import type { InboundMailAdapter } from '../domain/ingress-adapter';

const context: ImportContext = {
  accountId: 'account-1' as MailAccountId,
  connectionId: 'connection-1',
  provider: 'gmail',
  scope: {
    version: 1,
    mailboxRoles: ['inbox'],
    initialSync: 'none',
  },
  inboxMailboxId: 'inbox-1' as MailboxId,
};

describe('pending inbound message import', () => {
  it('imports every claimed raw MIME into the local Inbox and records success', async () => {
    const importedInputs: unknown[] = [];
    const marked: unknown[] = [];
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        throw new Error('unused');
      },
      discover: async () => {
        throw new Error('unused');
      },
      fetchRawMessage: async ({ remoteMessageId }) => ({
        remoteMessageId,
        raw: new TextEncoder().encode(`Message-ID: <${remoteMessageId}>\r\n\r\nbody`),
        receivedAt: new Date('2026-01-01T10:00:00.000Z'),
      }),
      classifyError: () => 'permanent',
    };

    const result = await importPendingMessages(
      {
        syncId: 'sync-1',
        owner: 'worker-1',
        limit: 10,
        leaseForMs: 60_000,
        maxAttempts: 5,
        baseRetryDelayMs: 1_000,
      },
      {
        clock: { now: () => new Date('2026-01-01T10:01:00.000Z') },
        resolveContext: async () => context,
        getAdapterFactory: () => ({ create: async () => adapter }),
        repository: {
          claimPendingItems: async () => [
            {
              id: 'item-1',
              remoteMessageId: 'message-1',
              remoteThreadId: 'provider-thread-1',
              attemptCount: 1,
              leaseOwner: 'worker-1',
            },
            {
              id: 'item-2',
              remoteMessageId: 'message-2',
              remoteThreadId: null,
              attemptCount: 1,
              leaseOwner: 'worker-1',
            },
          ],
          markImported: async (input) => {
            marked.push(input);
          },
          scheduleRetry: async () => {
            throw new Error('must not retry');
          },
          markFailed: async () => {
            throw new Error('must not fail');
          },
        },
        mailCore: {
          importEmail: async (input) => {
            importedInputs.push(input);
            return {
              created: true,
              emailId: `local-${input.remoteEmailId}` as EmailId,
            };
          },
        },
        onAuthenticationError: async () => undefined,
      },
    );

    expect(result).toEqual({
      claimed: 2,
      imported: 2,
      retried: 0,
      failed: 0,
    });
    expect(importedInputs).toEqual([
      expect.objectContaining({
        accountId: 'account-1',
        provider: 'gmail',
        remoteEmailId: 'message-1',
        remoteThreadId: 'provider-thread-1',
        mailboxIds: ['inbox-1'],
        keywords: [],
      }),
      expect.objectContaining({
        remoteEmailId: 'message-2',
        remoteThreadId: null,
      }),
    ]);
    expect(marked).toEqual([
      expect.objectContaining({
        itemId: 'item-1',
        owner: 'worker-1',
        localEmailId: 'local-message-1',
      }),
      expect.objectContaining({
        itemId: 'item-2',
        owner: 'worker-1',
        localEmailId: 'local-message-2',
      }),
    ]);
  });

  it('retries transient failures with bounded exponential delay and continues the batch', async () => {
    const retries: unknown[] = [];
    const failed: unknown[] = [];
    const adapter: InboundMailAdapter = {
      provider: 'gmail',
      establishCheckpoint: async () => {
        throw new Error('unused');
      },
      discover: async () => {
        throw new Error('unused');
      },
      fetchRawMessage: async ({ remoteMessageId }) => {
        if (remoteMessageId === 'retry') {
          throw new Error('temporary');
        }
        if (remoteMessageId === 'poison') {
          throw new Error('bad mime');
        }
        return {
          remoteMessageId,
          raw: new Uint8Array(),
          receivedAt: null,
        };
      },
      classifyError: (error) =>
        error instanceof Error && error.message === 'temporary' ? 'retryable' : 'permanent',
    };

    const result = await importPendingMessages(
      {
        syncId: 'sync-1',
        owner: 'worker-1',
        limit: 10,
        leaseForMs: 60_000,
        maxAttempts: 3,
        baseRetryDelayMs: 1_000,
      },
      {
        clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
        resolveContext: async () => context,
        getAdapterFactory: () => ({ create: async () => adapter }),
        repository: {
          claimPendingItems: async () => [
            {
              id: 'item-retry',
              remoteMessageId: 'retry',
              remoteThreadId: null,
              attemptCount: 2,
              leaseOwner: 'worker-1',
            },
            {
              id: 'item-poison',
              remoteMessageId: 'poison',
              remoteThreadId: null,
              attemptCount: 1,
              leaseOwner: 'worker-1',
            },
            {
              id: 'item-exhausted',
              remoteMessageId: 'retry',
              remoteThreadId: null,
              attemptCount: 3,
              leaseOwner: 'worker-1',
            },
          ],
          markImported: async () => {
            throw new Error('must not import');
          },
          scheduleRetry: async (input) => {
            retries.push(input);
          },
          markFailed: async (input) => {
            failed.push(input);
          },
        },
        mailCore: {
          importEmail: async () => {
            throw new Error('must not reach MailCore');
          },
        },
        onAuthenticationError: async () => undefined,
      },
    );

    expect(result).toEqual({
      claimed: 3,
      imported: 0,
      retried: 1,
      failed: 2,
    });
    expect(retries).toEqual([
      expect.objectContaining({
        itemId: 'item-retry',
        nextAttemptAt: new Date('2026-01-01T00:00:02.000Z'),
        errorCode: 'MAIL_SYNC_IMPORT_RETRYABLE',
      }),
    ]);
    expect(failed).toEqual([
      expect.objectContaining({
        itemId: 'item-poison',
        errorCode: 'MAIL_SYNC_IMPORT_PERMANENT',
      }),
      expect.objectContaining({
        itemId: 'item-exhausted',
        errorCode: 'MAIL_SYNC_IMPORT_ATTEMPTS_EXHAUSTED',
      }),
    ]);
  });
});
