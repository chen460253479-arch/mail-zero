# Attachment Upload UI Implementation Plan

> **For Codex:** Follow the repository's test-driven workflow and preserve all existing uncommitted work.

**Goal:** Make compose attachments upload immediately, display their real upload state inline, and prevent sending until every retained attachment is uploaded successfully.

**Architecture:** Keep the existing `File[]` delivery contract, but move compose-time attachment state into a dedicated upload hook. The hook uploads raw bytes through the existing blob endpoint, caches the returned blob ID for the delivery layer, and exposes pure state transitions to an inline attachment-list component. The composer saves and sends only successfully uploaded files.

**Tech Stack:** React, TypeScript, Vitest, XMLHttpRequest upload progress, existing mail blob API and S3-backed server storage.

---

### Task 1: Define and test upload transport progress

**Files:**

- Modify: `apps/mail/modules/mail/api/blob-client.ts`
- Test: `apps/mail/modules/mail/api/blob-client.test.ts`

Add failing tests for progress, success, failure, and abort. Then add an XMLHttpRequest-based upload function that reports request-body progress and only reaches 100% after the server confirms the object write.

### Task 2: Define and test attachment state

**Files:**

- Create: `apps/mail/components/create/attachment-upload-state.ts`
- Create: `apps/mail/components/create/attachment-upload-state.test.ts`
- Create: `apps/mail/components/create/use-attachment-uploads.ts`

Add failing reducer tests for add, progress, success, failure, retry, and removal. Implement the state model and connect it to the upload transport and existing blob-ID cache.

### Task 3: Build the inline attachment cards

**Files:**

- Create: `apps/mail/components/create/attachment-upload-list.tsx`
- Modify: `apps/mail/components/create/email-composer.tsx`
- Modify: `apps/mail/components/create/email-composer-attachments.test.ts`

Replace the attachment popover with inline cards. Show filename, size, progress/status, retry on failure, and a right-aligned trash button. Remove the file-type restriction and image preview/object URL behavior.

### Task 4: Enforce draft and send boundaries

**Files:**

- Modify: `apps/mail/components/create/email-composer.tsx`
- Modify: `apps/mail/messages/en.json`
- Modify: `apps/mail/messages/zh.json`

Save only uploaded attachments, defer autosave while uploads are active, and block button, keyboard, and warning-dialog send paths while any retained attachment is uploading or failed.

### Task 5: Verify

Run focused attachment state and transport tests, existing compose/delivery tests, lint, and TypeScript checks. Do not commit or push without an explicit user request.
