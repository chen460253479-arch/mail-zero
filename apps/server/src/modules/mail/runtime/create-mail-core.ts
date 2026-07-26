import {
  createMailCore,
  createMailCoreMaintenance,
  type BlobReadAuditSink,
  type BlobStore,
  type Id,
  type MailCore,
  type MailCoreDependencies,
  type MailCoreMaintenance,
} from '@zero/mail-core';

import { PostgresMailUnitOfWork } from '../postgres/postgres-unit-of-work';
import { PostgresSearchStore } from '../search/postgres-search-store';
import type { DB } from '../../../db';

export type CreateMailCoreRuntimeInput = {
  db: DB;
  blobStore: BlobStore;
  blobReadAuditSink: BlobReadAuditSink;
  clock: { now(): Date };
  idFactory: { next<Kind extends string>(): Id<Kind> };
  sanitizeHtml(html: string): string;
  cursorSigningKey: string;
};

export const createMailCoreDependencies = (
  input: CreateMailCoreRuntimeInput,
): MailCoreDependencies => ({
  unitOfWork: new PostgresMailUnitOfWork(input.db),
  searchStore: new PostgresSearchStore(input.db),
  blobStore: input.blobStore,
  blobReadAuditSink: input.blobReadAuditSink,
  clock: input.clock,
  idFactory: input.idFactory,
  sanitizeHtml: input.sanitizeHtml,
  cursorSigningKey: input.cursorSigningKey,
});

export const createMailCoreRuntime = (input: CreateMailCoreRuntimeInput): MailCore =>
  createMailCore(createMailCoreDependencies(input));

export const createMailCoreMaintenanceRuntime = (
  input: CreateMailCoreRuntimeInput,
): MailCoreMaintenance => createMailCoreMaintenance(createMailCoreDependencies(input));
