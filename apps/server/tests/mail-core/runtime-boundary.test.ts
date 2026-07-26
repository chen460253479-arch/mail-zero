import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MemoryBlobStore,
  createMailCoreMaintenanceRuntime,
  createMailCoreRuntime,
} from '../../src/modules/mail';
import type { Id } from '@zero/mail-core';
import type { DB } from '../../src/db';

const listTypeScriptFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });

const createConstructionOnlyDatabase = (): DB =>
  new Proxy(
    {},
    {
      get() {
        throw new Error('runtime construction must not access PostgreSQL');
      },
    },
  ) as DB;

describe('mail runtime boundary', () => {
  it('constructs the public facade with memory Blob storage and no Cloudflare globals', () => {
    let nextId = 1;
    const runtime = createMailCoreRuntime({
      db: createConstructionOnlyDatabase(),
      blobStore: new MemoryBlobStore(),
      blobReadAuditSink: { record: async () => undefined },
      clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
      idFactory: {
        next<Kind extends string>() {
          const id = `runtime-${nextId.toString().padStart(4, '0')}`;
          nextId += 1;
          return id as Id<Kind>;
        },
      },
      sanitizeHtml: (html) => html,
    });

    expect(Object.keys(runtime).sort()).toEqual(
      [
        'cancelSubmission',
        'createAccount',
        'createDraft',
        'createIdentity',
        'createMailbox',
        'createSubmission',
        'destroyDraft',
        'destroyEmail',
        'destroyIdentity',
        'destroyMailbox',
        'finalizeSubmissionSent',
        'getChanges',
        'getEmail',
        'getThread',
        'importEmail',
        'listMailboxes',
        'queryEmails',
        'queryThreads',
        'readBlob',
        'updateDraft',
        'updateEmail',
        'updateIdentity',
        'updateMailbox',
      ].sort(),
    );
  });

  it('constructs destructive operations on a separate maintenance facade', () => {
    let nextId = 1;
    const maintenance = createMailCoreMaintenanceRuntime({
      db: createConstructionOnlyDatabase(),
      blobStore: new MemoryBlobStore(),
      blobReadAuditSink: { record: async () => undefined },
      clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
      idFactory: {
        next<Kind extends string>() {
          const id = `maintenance-${nextId.toString().padStart(4, '0')}`;
          nextId += 1;
          return id as Id<Kind>;
        },
      },
      sanitizeHtml: (html) => html,
    });

    expect(Object.keys(maintenance).sort()).toEqual(
      ['garbageCollectBlobs', 'reconcileBlobStorage', 'reconcileMailAggregates'].sort(),
    );
  });

  it('keeps provider, Cloudflare, tRPC, and server dependencies outside the pure core', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const coreFiles = listTypeScriptFiles(resolve(root, 'packages/mail-core/src'));
    const forbidden =
      /@googleapis\/gmail|@microsoft|cloudflare:|R2Bucket|DurableObject|@trpc|@zero\/server|apps\/server|src\/modules\/mail/u;

    for (const file of coreFiles) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    }
  });

  it('does not cut current mail, draft, or label routes over to the local runtime', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    for (const route of [
      'apps/server/src/trpc/routes/mail.ts',
      'apps/server/src/trpc/routes/drafts.ts',
      'apps/server/src/trpc/routes/label.ts',
    ]) {
      expect(readFileSync(resolve(root, route), 'utf8'), route).not.toContain(
        'createMailCoreRuntime',
      );
    }
  });
});
