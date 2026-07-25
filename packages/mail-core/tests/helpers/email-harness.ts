import { readFileSync } from 'node:fs';

import {
  createMailAccount,
  importEmail,
  type BlobId,
  type BlobRecord,
  type EmailId,
  type Keyword,
  type MailAccountId,
  type MailboxId,
  type ThreadId,
} from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

const raw = new Uint8Array(readFileSync(new URL('../fixtures/simple.eml', import.meta.url)));

export async function createSeededEmailHarness(options: { keywords?: Keyword[] } = {}) {
  const deps = createMemoryMailCoreDependencies();
  const account = await createMailAccount(deps, {
    userId: 'state-user',
    connectionId: 'state-connection',
    timezone: 'UTC',
    storageQuotaBytes: null,
  });
  const mailboxes = await deps.inspect.mailboxes(account.id);
  const inbox = mailboxes.find(({ role }) => role === 'inbox')!;
  const archive = mailboxes.find(({ role }) => role === 'archive')!;
  const trash = mailboxes.find(({ role }) => role === 'trash')!;
  const imported = await importEmail(deps, {
    accountId: account.id,
    provider: 'fixture',
    remoteEmailId: 'state-remote',
    remoteThreadId: null,
    raw,
    mailboxIds: [inbox.id],
    keywords: options.keywords ?? [],
    receivedAt: deps.clock.now(),
  });
  const email = (await deps.inspect.email(imported.emailId))!;
  const seededBlobKeys = new Map<BlobId, string>();

  return {
    deps,
    accountId: account.id,
    emailId: email.id,
    threadId: email.threadId,
    inboxId: inbox.id,
    archiveId: archive.id,
    trashId: trash.id,
    clock: deps.clock,
    raw: Uint8Array.from(raw),
    inspect: {
      stateVersion: () => deps.inspect.stateVersion(account.id),
      mailbox: (id: MailboxId) => deps.inspect.mailbox(id),
      thread: (id: ThreadId) => deps.inspect.thread(id),
      email: (id: EmailId) => deps.inspect.email(id),
      visibleEmail: async (id: EmailId) => {
        const stored = await deps.inspect.email(id);
        return stored === null || stored.destroyedAt !== null || stored.mailboxIds.length === 0
          ? null
          : stored;
      },
      changes: () => deps.inspect.changes(account.id),
      blob: (id: BlobId) => deps.inspect.blob(id),
      rawBlob: async (id: EmailId) => {
        const stored = await deps.inspect.email(id);
        if (stored?.blobId === null || stored?.blobId === undefined) {
          throw new Error('seeded Email has no raw Blob');
        }
        const blob = await deps.inspect.blob(stored.blobId);
        if (blob === null) {
          throw new Error('seeded Email raw Blob metadata is missing');
        }
        return blob;
      },
      seedOrphanBlob: async ({
        ageMs,
        accountId = account.id,
      }: {
        ageMs: number;
        accountId?: MailAccountId;
      }): Promise<BlobRecord> => {
        const bytes = new TextEncoder().encode(`orphan-${accountId}-${seededBlobKeys.size}`);
        const pending = await deps.blobStore.putTemporary({
          accountId,
          bytes,
          contentType: 'application/octet-stream',
        });
        const id = deps.idFactory.next<'Blob'>() as BlobId;
        const objectKey = `mail/${accountId}/sha256/${pending.sha256.slice(0, 2)}/${pending.sha256}`;
        await deps.blobStore.commitTemporary({
          accountId,
          temporaryKey: pending.temporaryKey,
          objectKey,
        });
        const createdAt = new Date(deps.clock.now().getTime() - ageMs);
        const record: BlobRecord = {
          id,
          accountId,
          sha256: pending.sha256,
          sizeBytes: pending.size,
          contentType: 'application/octet-stream',
          objectKey,
          status: 'ready',
          createdAt,
          readyAt: createdAt,
          deletedAt: null,
        };
        await deps.unitOfWork.run((tx) => tx.blobs.insert(record));
        seededBlobKeys.set(id, objectKey);
        return record;
      },
      failNextBlobDelete: (id: BlobId) => {
        const objectKey = seededBlobKeys.get(id);
        if (objectKey === undefined) {
          throw new Error('can only fail deletion for a seeded orphan Blob');
        }
        deps.blobStore.failNextDelete(objectKey);
      },
      objectExists: (objectKey: string) => deps.blobStore.snapshot().has(objectKey),
    },
  };
}
