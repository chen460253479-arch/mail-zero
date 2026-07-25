import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import { createMailAccount, type ImportEmailInput } from '../../src';

const raw = new Uint8Array(readFileSync(resolve(import.meta.dirname, '../fixtures/multipart.eml')));
const fixtureAccountInput = {
  userId: 'user-1',
  connectionId: 'connection-1',
  timezone: 'UTC',
} as const;

export const createSeededImportDependencies = async (
  options: {
    corruptBlobOnCommit?: 'sha256' | 'size';
    failBlobCommit?: boolean;
    sanitizeHtml?: (html: string) => string;
    storageQuotaBytes?: bigint | null;
  } = {},
): Promise<{
  core: ReturnType<typeof createMemoryMailCoreDependencies>;
  input: ImportEmailInput;
}> => {
  const core = createMemoryMailCoreDependencies({
    corruptBlobOnCommit: options.corruptBlobOnCommit,
    failBlobCommit: options.failBlobCommit ?? false,
    sanitizeHtml: options.sanitizeHtml,
  });
  const account = await createMailAccount(core, {
    ...fixtureAccountInput,
    storageQuotaBytes: options.storageQuotaBytes ?? null,
  });
  const inbox = (await core.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;

  return {
    core,
    input: {
      accountId: account.id,
      provider: 'fixture',
      remoteEmailId: 'remote-1',
      remoteThreadId: null,
      raw,
      mailboxIds: [inbox.id],
      keywords: [],
      receivedAt: new Date('2026-01-01T00:00:00Z'),
    },
  };
};
