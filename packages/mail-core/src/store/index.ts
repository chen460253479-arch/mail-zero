import type { MailUnitOfWork } from './unit-of-work';
import type { SearchStore } from './search-store';
import type { BlobReadAuditSink } from '../blob';
import type { BlobStore } from './blob-store';
import type { Id } from '../types';

export type MailCoreDependencies = {
  unitOfWork: MailUnitOfWork;
  blobStore: BlobStore;
  blobReadAuditSink: BlobReadAuditSink;
  searchStore: SearchStore;
  clock: { now(): Date };
  idFactory: { next<Kind extends string>(): Id<Kind> };
  sanitizeHtml(html: string): string;
};

export type { BlobCommitReceipt, BlobStore, BlobStoreEntry, BlobStoreListPage } from './blob-store';
export * from './repositories';
export type {
  SearchEmailFilter,
  SearchEmailCursor,
  SearchEmailInput,
  SearchEmailResult,
  SearchEmailSort,
  SearchStore,
} from './search-store';
export type { MailTransaction, MailUnitOfWork } from './unit-of-work';
export type {
  ThreadQueryPosition,
  ThreadQueryProjection,
  ThreadQueryRepository,
} from './thread-query-store';
