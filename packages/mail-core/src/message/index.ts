export { destroyEmail, type DestroyEmailInput, type DestroyEmailResult } from './destroy-email';
export { createDraft } from './create-draft';
export { destroyDraft } from './destroy-draft';
export {
  garbageCollectBlobs,
  type GarbageCollectBlobsInput,
  type GarbageCollectBlobsResult,
} from './garbage-collect-blobs';
export { importEmail } from './import-email';
export { parseRawEmail } from './mime';
export { renderDraft } from './render-draft';
export { updateDraft } from './update-draft';
export {
  moveEmailToTrash,
  restoreEmail,
  updateEmail,
  type EmailStateInput,
  type EmailStateResult,
  type UpdateEmailInput,
} from './update-email';
export type {
  CreateDraftInput,
  DestroyDraftInput,
  DestroyDraftResult,
  DraftContent,
  DraftResult,
  RenderDraftInput,
  UpdateDraftInput,
} from './draft-types';
export type {
  ImportEmailInput,
  ImportEmailResult,
  ParsedEmail,
  ParsedPart,
  ParseRawEmailDependencies,
} from './types';
