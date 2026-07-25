import type {
  EmailId,
  Id,
  MailAccountId,
} from '../types';
import type {
  MailCoreDependencies,
  SearchEmailInput,
  SearchEmailResult,
  SearchStore,
} from '../store';
import { MemoryBlobStore } from './memory-blob-store';
import {
  createMemoryMailInspector,
  MemoryMailUnitOfWork,
} from './memory-mail-store';

export interface CreateMemoryMailCoreDependenciesOptions {
  corruptBlobOnCommit?: 'sha256' | 'size';
  failBlobCommit?: boolean;
  now?: Date;
  sanitizeHtml?: (html: string) => string;
}

export class MemoryClock {
  private current: Date;

  constructor(now = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(now);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(now: Date): void {
    this.current = new Date(now);
  }
}

export class MemorySearchStore implements SearchStore {
  async query(_input: SearchEmailInput): Promise<SearchEmailResult> {
    return { emailIds: [], nextCursor: null };
  }
}

export const createMemoryMailCoreDependencies = (
  options: CreateMemoryMailCoreDependenciesOptions = {},
) => {
  const unitOfWork = new MemoryMailUnitOfWork();
  const blobStore = new MemoryBlobStore({
    corruptOnCommit: options.corruptBlobOnCommit,
    failCommit: options.failBlobCommit,
  });
  const searchStore = new MemorySearchStore();
  const clock = new MemoryClock(options.now);
  const baseInspector = createMemoryMailInspector(unitOfWork);
  let nextId = 1;

  const dependencies: MailCoreDependencies = {
    unitOfWork,
    blobStore,
    searchStore,
    clock,
    idFactory: {
      next<Kind extends string>() {
        const id = `id-${nextId.toString().padStart(8, '0')}` as Id<Kind>;
        nextId += 1;
        return id;
      },
    },
    sanitizeHtml: options.sanitizeHtml ?? ((html) => html),
  };

  return {
    ...dependencies,
    unitOfWork,
    blobStore,
    searchStore,
    clock,
    inspect: {
      ...baseInspector,
      async rawBytes(emailId: EmailId): Promise<Uint8Array | null> {
        const email = await baseInspector.email(emailId);
        if (email?.blobId === null || email?.blobId === undefined) {
          return null;
        }
        const blob = await baseInspector.blob(email.blobId);
        return blob === null ? null : blobStore.get(blob.objectKey);
      },
      async stateVersion(accountId: MailAccountId): Promise<bigint> {
        return baseInspector.stateVersion(accountId);
      },
    },
  };
};
