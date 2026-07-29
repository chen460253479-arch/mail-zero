import { type BlobStore, type Id } from '@zero/mail-core';
import { ulid } from 'ulid';

import { createMailCoreDependencies, createMailCoreRuntime } from '../../modules/mail';
import { preprocessEmailHtml } from '../../lib/email-processor';
import type { DB } from '../../db';

export type MailCoreRuntimeResources = {
  blobStore: BlobStore;
  cursorSigningKey: string;
  notificationsEnabled?: boolean;
};

export const createMailCoreForEnvironment = (db: DB, resources: MailCoreRuntimeResources) =>
  createMailCoreRuntime({
    db,
    blobStore: resources.blobStore,
    blobReadAuditSink: { record: async () => undefined },
    clock: { now: () => new Date() },
    idFactory: {
      next<Kind extends string>() {
        return ulid() as Id<Kind>;
      },
    },
    sanitizeHtml: preprocessEmailHtml,
    cursorSigningKey: resources.cursorSigningKey,
    notificationsEnabled: resources.notificationsEnabled,
  });

export const createMailCoreDependenciesForEnvironment = (
  db: DB,
  resources: MailCoreRuntimeResources,
) =>
  createMailCoreDependencies({
    db,
    blobStore: resources.blobStore,
    blobReadAuditSink: { record: async () => undefined },
    clock: { now: () => new Date() },
    idFactory: {
      next<Kind extends string>() {
        return ulid() as Id<Kind>;
      },
    },
    sanitizeHtml: preprocessEmailHtml,
    cursorSigningKey: resources.cursorSigningKey,
    notificationsEnabled: resources.notificationsEnabled,
  });
