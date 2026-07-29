import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalBlobStore } from '../../../src/modules/mail';
import type { MailAccountId } from '@zero/mail-core';

const accountId = '01LOCALACCOUNT' as MailAccountId;
const otherAccountId = '01OTHERACCOUNT' as MailAccountId;
const bytes = new TextEncoder().encode('persistent local blob');
const digest = createHash('sha256').update(bytes).digest('hex');
const objectKey = `mail/${accountId}/sha256/${digest.slice(0, 2)}/${digest}`;

describe('LocalBlobStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zero-local-blob-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const createStore = async (): Promise<LocalBlobStore> => {
    const store = new LocalBlobStore(root);
    await store.initialize();
    return store;
  };

  it('persists committed bytes across store instances without retaining caller buffers', async () => {
    const firstStore = await createStore();
    const input = Uint8Array.from(bytes);
    const pending = await firstStore.putTemporary({
      accountId,
      bytes: input,
      contentType: 'text/plain',
    });
    input[0] = 0;

    await firstStore.commitTemporary({
      accountId,
      temporaryKey: pending.temporaryKey,
      objectKey,
    });

    const secondStore = await createStore();
    const firstRead = await secondStore.get({ accountId, objectKey });
    firstRead[0] = 0;
    await expect(secondStore.get({ accountId, objectKey })).resolves.toEqual(bytes);
  });

  it('commits the same content-addressed object idempotently', async () => {
    const store = await createStore();
    const first = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    await expect(
      store.commitTemporary({ accountId, temporaryKey: first.temporaryKey, objectKey }),
    ).resolves.toEqual({ objectKey, created: true });

    const second = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'application/octet-stream',
    });
    await expect(
      store.commitTemporary({ accountId, temporaryKey: second.temporaryKey, objectKey }),
    ).resolves.toEqual({ objectKey, created: true });
    await expect(store.get({ accountId, objectKey })).resolves.toEqual(bytes);
  });

  it('returns exact byte ranges', async () => {
    const store = await createStore();
    const pending = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    await store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey });

    await expect(store.getRange({ accountId, objectKey, offset: 3, length: 7 })).resolves.toEqual(
      bytes.slice(3, 10),
    );
  });

  it('lists account-owned temporary objects with cursor isolation', async () => {
    const store = await createStore();
    await store.putTemporary({
      accountId,
      bytes: new TextEncoder().encode('first'),
      contentType: 'text/plain',
    });
    await store.putTemporary({
      accountId,
      bytes: new TextEncoder().encode('second'),
      contentType: 'text/plain',
    });
    await store.putTemporary({
      accountId: otherAccountId,
      bytes: new TextEncoder().encode('other'),
      contentType: 'text/plain',
    });

    const firstPage = await store.list({
      accountId,
      kind: 'temporary',
      cursor: null,
      limit: 1,
    });
    const secondPage = await store.list({
      accountId,
      kind: 'temporary',
      cursor: firstPage.cursor,
      limit: 1,
    });

    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.cursor).not.toBeNull();
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.cursor).toBeNull();
    expect(
      [...firstPage.entries, ...secondPage.entries].every(({ key }) =>
        key.startsWith(`mail/${accountId}/temporary/`),
      ),
    ).toBe(true);
    await expect(
      store.list({
        accountId: otherAccountId,
        kind: 'temporary',
        cursor: firstPage.cursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BLOB_KEY' });
  });

  it('deletes temporary and committed files idempotently', async () => {
    const store = await createStore();
    const discarded = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    await store.deleteTemporary({ accountId, temporaryKey: discarded.temporaryKey });
    await expect(
      store.commitTemporary({
        accountId,
        temporaryKey: discarded.temporaryKey,
        objectKey,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_NOT_FOUND' });

    const committed = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    await store.commitTemporary({
      accountId,
      temporaryKey: committed.temporaryKey,
      objectKey,
    });
    await store.delete({ accountId, objectKey });
    await expect(store.delete({ accountId, objectKey })).resolves.toBeUndefined();
    await expect(store.get({ accountId, objectKey })).rejects.toMatchObject({
      code: 'BLOB_NOT_FOUND',
    });
  });

  it.each([
    '../escape',
    `mail/${accountId}/sha256/00/${digest}`,
    `mail/${accountId}/sha256/${digest.slice(0, 2)}/${digest}/extra`,
    `mail/../sha256/${digest.slice(0, 2)}/${digest}`,
  ])('rejects malformed object key %s before filesystem access', async (invalidKey) => {
    const store = await createStore();
    await expect(store.get({ accountId, objectKey: invalidKey })).rejects.toMatchObject({
      code: 'INVALID_BLOB_KEY',
    });
    await expect(store.delete({ accountId, objectKey: invalidKey })).rejects.toMatchObject({
      code: 'INVALID_BLOB_KEY',
    });
  });

  it('rejects an existing object whose bytes do not match its content-addressed key', async () => {
    const store = await createStore();
    const targetPath = join(root, ...objectKey.split('/'));
    await mkdir(join(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, new TextEncoder().encode('conflicting bytes'));
    const pending = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });

    await expect(
      store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey }),
    ).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' });
  });
});
