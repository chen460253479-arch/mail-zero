import type { MailUnitOfWork } from './unit-of-work';
import type { SearchStore } from './search-store';
import type { BlobStore } from './blob-store';
import type { Id } from '../types';

export type MailCoreDependencies = {
  unitOfWork: MailUnitOfWork;
  blobStore: BlobStore;
  searchStore: SearchStore;
  clock: { now(): Date };
  idFactory: { next<Kind extends string>(): Id<Kind> };
  sanitizeHtml(html: string): string;
};

export type { BlobCommitReceipt, BlobStore } from './blob-store';
export * from './repositories';
export type {
  SearchEmailFilter,
  SearchEmailInput,
  SearchEmailResult,
  SearchEmailSort,
  SearchStore,
} from './search-store';
export type { MailTransaction, MailUnitOfWork } from './unit-of-work';
