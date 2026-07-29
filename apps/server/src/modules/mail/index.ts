export { MemoryBlobStore } from './blob/memory-blob-store';
export { LocalBlobStore } from './blob/local-blob-store';
export { R2BlobStore, type R2BucketLike, type R2ObjectLike } from './blob/r2-blob-store';
export {
  createMailCoreDependencies,
  createMailCoreMaintenanceRuntime,
  createMailCoreRuntime,
  type CreateMailCoreRuntimeInput,
} from './runtime/create-mail-core';
