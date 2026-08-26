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
      join(repositoryRoot, 'apps/server/src/db/migrations/0000_big_ultron.sql'),
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

  it('renders the editor while persisted attachments load and blocks only save and send', () => {
    expect(source).toContain('initialAttachmentsLoading');
    expect(source).toContain('initialAttachmentsError');
    expect(source).toContain('<DraftAttachmentLoadingList');
    expect(attachmentListSource).toContain("m['pages.createEmail.attachmentDownloading']()");
    expect(source).toContain('if (hasBlockingAttachments)');
    expect(source).toContain('if (!hasUnsavedChanges || hasBlockingAttachments) return;');
  });

  it('shows persisted attachment metadata before its bytes finish downloading', () => {
    expect(source).toContain('initialAttachmentDescriptors');
    expect(createEmailSource).toContain(
      'initialAttachmentDescriptors={typedDraft?.attachments ?? []}',
    );
    expect(attachmentListSource).toContain('attachment.filename');
    expect(attachmentListSource).toContain('formatFileSize(Number(attachment.size) || 0)');
  });
});
