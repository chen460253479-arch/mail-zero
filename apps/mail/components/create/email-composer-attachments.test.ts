import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const source = readFileSync(new URL('./email-composer.tsx', import.meta.url), 'utf8');
const attachmentListSource = readFileSync(
  new URL('./attachment-upload-list.tsx', import.meta.url),
  'utf8',
);
const createEmailSource = readFileSync(new URL('./create-email.tsx', import.meta.url), 'utf8');
const useDraftsSource = readFileSync(new URL('../../hooks/use-drafts.ts', import.meta.url), 'utf8');
const deliverySource = readFileSync(
  new URL('../../modules/mail/mutations/use-mail-delivery.ts', import.meta.url),
  'utf8',
);
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('email composer attachments', () => {
  it('preserves selected image files without compression or re-encoding', () => {
    expect(source).not.toContain('compressImages');
    expect(source).not.toContain('ImageCompressionSettings');
    expect(source).not.toContain('processAndSetAttachments');
  });

  it('does not retain image-compression settings, components, or translations', () => {
    const messageDirectory = join(repositoryRoot, 'apps/mail/messages');
    const files = [
      ...readdirSync(messageDirectory)
        .filter((filename) => filename.endsWith('.json'))
        .map((filename) => join(messageDirectory, filename)),
      join(repositoryRoot, 'apps/server/src/lib/schemas.ts'),
      join(repositoryRoot, 'apps/server/src/db/migrations/0000_tiny_karma.sql'),
      join(repositoryRoot, 'apps/server/src/db/migrations/meta/0000_snapshot.json'),
      join(repositoryRoot, 'i18n.lock'),
    ];
    const retainedConfiguration = files.map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(retainedConfiguration).not.toMatch(
      /imageCompression|compressionFailed|compressionSavings/u,
    );
  });

  it('uses an inline upload-state list and accepts every attachment file type', () => {
    expect(source).toContain('<AttachmentUploadList');
    expect(source).toContain("m['pages.createEmail.attachmentsLabel']()");
    expect(source).not.toContain('<Popover');
    expect(source).not.toContain('accept="image/*');
    expect(source).not.toContain('URL.createObjectURL');
  });

  it('blocks sending while an attachment is uploading or failed', () => {
    expect(source).toContain('attachmentUploadsBlockSend');
    expect(source).toContain('hasBlockingAttachments');
    expect(source).toMatch(/disabled=\{[^}]*hasBlockingAttachments/u);
  });

  it('renders persisted attachment metadata without downloading its bytes', () => {
    expect(source).not.toContain('initialAttachmentsLoading');
    expect(source).not.toContain('initialAttachmentsError');
    expect(source).not.toContain('<DraftAttachmentLoadingList');
    expect(createEmailSource).toContain('initialAttachments={typedDraft?.attachments ?? []}');
    expect(attachmentListSource).toContain('item.filename');
    expect(attachmentListSource).toContain('formatFileSize(item.size)');
    expect(source).toContain('if (hasBlockingAttachments)');
    expect(source).toContain('if (!hasUnsavedChanges || hasBlockingAttachments) return;');
  });

  it('does not retain the draft attachment download or client cache path', () => {
    expect(useDraftsSource).not.toContain('useDraftAttachments');
    expect(useDraftsSource).not.toContain('DRAFT_ATTACHMENT_CACHE_RETENTION');
    expect(deliverySource).not.toContain('attachmentBlobIdCache');
    expect(deliverySource).not.toContain('WeakMap<File');
    expect(deliverySource).not.toContain('uploadMailBlob');
  });
});
