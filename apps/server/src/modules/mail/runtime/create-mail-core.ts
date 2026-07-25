import { createMailCore, type BlobStore, type Id, type MailCore } from '@zero/mail-core';

import { PostgresMailUnitOfWork } from '../postgres/postgres-unit-of-work';
import { PostgresSearchStore } from '../search/postgres-search-store';
import type { DB } from '../../../db';

export type CreateMailCoreRuntimeInput = {
  db: DB;
  blobStore: BlobStore;
  clock: { now(): Date };
  idFactory: { next<Kind extends string>(): Id<Kind> };
  sanitizeHtml(html: string): string;
};

export const createMailCoreRuntime = (input: CreateMailCoreRuntimeInput): MailCore =>
  createMailCore({
    unitOfWork: new PostgresMailUnitOfWork(input.db),
    searchStore: new PostgresSearchStore(input.db),
    blobStore: input.blobStore,
    clock: input.clock,
    idFactory: input.idFactory,
    sanitizeHtml: input.sanitizeHtml,
  });
