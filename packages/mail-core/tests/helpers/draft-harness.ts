import {
  createIdentity,
  createMailAccount,
  type BlobId,
  type BlobRecord,
  type CreateDraftInput,
  type EmailId,
  type EmailLifecycle,
  type IdentityId,
  type MailAccountId,
  type MailAddress,
  type MailboxId,
} from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

type HarnessDependencies = ReturnType<typeof createMemoryMailCoreDependencies>;

const createAccountFixture = async (
  deps: HarnessDependencies,
  suffix: string,
  storageQuotaBytes: bigint | null,
) => {
  const account = await createMailAccount(deps, {
    userId: `draft-user-${suffix}`,
    connectionId: `draft-connection-${suffix}`,
    timezone: 'UTC',
    storageQuotaBytes,
  });
  const identity = await createIdentity(deps, {
    accountId: account.id,
    name: `Draft Sender ${suffix}`,
    email: `sender-${suffix}@example.test`,
    replyTo: `reply-${suffix}@example.test`,
    makeDefault: true,
  });
  const drafts = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'drafts')!;
  return { account, identity, drafts };
};

const seedBlob = async (
  deps: HarnessDependencies,
  accountId: MailAccountId,
  bytes: Uint8Array,
  contentType: string,
  status: 'pending' | 'ready',
): Promise<BlobRecord> => {
  const account = await deps.inspect.account(accountId);
  if (account === null) throw new Error('mail account fixture is missing');
  const pending = await deps.blobStore.putTemporary({
    userId: account.userId,
    accountId,
    kind: 'attachment',
    bytes,
    contentType,
  });
  const id = deps.idFactory.next<'Blob'>() as BlobId;
  const objectKey = `mail/users/${account.userId}/accounts/${accountId}/attachments/sha256/${pending.sha256.slice(0, 2)}/${pending.sha256}`;
  await deps.blobStore.commitTemporary({
    accountId,
    temporaryKey: pending.temporaryKey,
    objectKey,
  });
  const now = deps.clock.now();
  const record: BlobRecord = {
    id,
    accountId,
    kind: 'attachment',
    sha256: pending.sha256,
    sizeBytes: pending.size,
    contentType,
    objectKey,
    status,
    createdAt: now,
    readyAt: status === 'ready' ? now : null,
    deletedAt: null,
  };
  await deps.unitOfWork.run((tx) => tx.blobs.insert(record));
  return record;
};

export async function createDraftHarness(
  options: {
    storageQuotaBytes?: bigint | null;
  } = {},
) {
  const deps = createMemoryMailCoreDependencies();
  const primary = await createAccountFixture(deps, 'primary', options.storageQuotaBytes ?? null);
  const content: CreateDraftInput = {
    accountId: primary.account.id,
    identityId: primary.identity.id,
    replyToEmailId: null,
    to: [
      { name: 'First Recipient', email: 'first@example.test' },
      { name: 'Second Recipient', email: 'second@example.test' },
    ],
    cc: [{ name: 'Carbon Recipient', email: 'carbon@example.test' }],
    bcc: [{ name: 'Blind Recipient', email: 'blind@example.test' }],
    subject: 'Original subject',
    textBody: 'Plain draft body.',
    htmlBody: '<p>HTML draft body.</p>',
    attachments: [],
  };

  return {
    deps,
    accountId: primary.account.id,
    identityId: primary.identity.id,
    draftsMailboxId: primary.drafts.id,
    content,
    createForeignAccount: (suffix = 'foreign') => createAccountFixture(deps, suffix, null),
    seedReadyBlob: (
      bytes: Uint8Array,
      contentType = 'application/octet-stream',
      accountId = primary.account.id,
    ) => seedBlob(deps, accountId, bytes, contentType, 'ready'),
    seedPendingBlob: (
      bytes: Uint8Array,
      contentType = 'application/octet-stream',
      accountId = primary.account.id,
    ) => seedBlob(deps, accountId, bytes, contentType, 'pending'),
    inspect: {
      stateVersion: () => deps.inspect.stateVersion(primary.account.id),
      changes: () => deps.inspect.changes(primary.account.id),
      email: (id: EmailId) => deps.inspect.email(id),
      visibleEmail: async (id: EmailId) => {
        const email = await deps.inspect.email(id);
        return email === null || email.destroyedAt !== null || email.mailboxIds.length === 0
          ? null
          : email;
      },
      mailbox: (id: MailboxId) => deps.inspect.mailbox(id),
      rawBytes: async (id: EmailId) => {
        const bytes = await deps.inspect.rawBytes(id);
        if (bytes === null) {
          throw new Error('Draft has no Raw Blob bytes');
        }
        return bytes;
      },
      blob: (id: BlobId) => deps.inspect.blob(id),
      blobs: () => deps.inspect.blobs(primary.account.id),
      thread: (id: EmailId) =>
        deps.inspect
          .email(id)
          .then((email) => (email === null ? null : deps.inspect.thread(email.threadId))),
      setLifecycle: (id: EmailId, lifecycle: EmailLifecycle) =>
        deps.unitOfWork.run(async (tx) => {
          await tx.emails.update(primary.account.id, id, { lifecycle });
        }),
      setMessageId: (id: EmailId, messageId: string | null) =>
        deps.unitOfWork.run(async (tx) => {
          await tx.emails.update(primary.account.id, id, { messageId });
        }),
    },
  };
}

export const addressEmails = (addresses: MailAddress[]): string[] =>
  addresses.map(({ email }) => email);

export type DraftHarnessForeignReferences = {
  accountId: MailAccountId;
  identityId: IdentityId;
};
