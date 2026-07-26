export { destroyEmail, type DestroyEmailInput, type DestroyEmailResult } from './destroy-email';
export { createDraft } from './create-draft';
export { destroyDraft } from './destroy-draft';
export {
  garbageCollectBlobs,
  type GarbageCollectBlobsInput,
  type GarbageCollectBlobsResult,
} from './garbage-collect-blobs';
export { importEmail } from './import-email';
export { getEmail, getEmails, type GetEmailInput, type GetEmailsInput } from './get-email';
export {
  normalizeSearchText,
  queryEmails,
  type EmailQueryResult,
  type QueryEmailsInput,
} from './query-emails';
export { parseRawEmail } from './mime';
export { renderDraft } from './render-draft';
export { updateDraft } from './update-draft';
export {
  setEmails,
  type EmailSetPatch,
  type SetEmailsInput,
  type SetEmailsResult,
} from './set-emails';
export {
  applyPreparedEmailStateInTransaction,
  moveEmailToTrash,
  prepareEmailStateReplacementInTransaction,
  restoreEmail,
  updateEmail,
  updateEmailInTransaction,
  type PreparedEmailStateMutation,
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
