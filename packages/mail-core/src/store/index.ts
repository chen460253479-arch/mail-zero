import type { Id } from '../types';
import type { BlobStore } from './blob-store';
import type { SearchStore } from './search-store';
import type { MailUnitOfWork } from './unit-of-work';

export type MailCoreDependencies = {
  unitOfWork: MailUnitOfWork;
  blobStore: BlobStore;
  searchStore: SearchStore;
  clock: { now(): Date };
  idFactory: { next<Kind extends string>(): Id<Kind> };
  sanitizeHtml(html: string): string;
};

export type { BlobStore } from './blob-store';
export * from './repositories';
export type {
  SearchEmailFilter,
  SearchEmailInput,
  SearchEmailResult,
  SearchEmailSort,
  SearchStore,
} from './search-store';
export type { MailTransaction, MailUnitOfWork } from './unit-of-work';
