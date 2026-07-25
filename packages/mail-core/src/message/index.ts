export { destroyEmail, type DestroyEmailInput, type DestroyEmailResult } from './destroy-email';
export {
  garbageCollectBlobs,
  type GarbageCollectBlobsInput,
  type GarbageCollectBlobsResult,
} from './garbage-collect-blobs';
export { importEmail } from './import-email';
export { parseRawEmail } from './mime';
export {
  moveEmailToTrash,
  restoreEmail,
  updateEmail,
  type EmailStateInput,
  type EmailStateResult,
  type UpdateEmailInput,
} from './update-email';
export type {
  ImportEmailInput,
  ImportEmailResult,
  ParsedEmail,
  ParsedPart,
  ParseRawEmailDependencies,
} from './types';
