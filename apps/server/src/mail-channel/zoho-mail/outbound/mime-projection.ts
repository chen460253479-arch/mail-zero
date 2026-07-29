import { parseRawEmail } from '@zero/mail-core';

export type ZohoMimeProjection = {
  subject: string;
  content: string;
  mailFormat: 'html' | 'plaintext';
  attachments: Array<{
    filename: string;
    bytes: Uint8Array;
  }>;
};

export const projectFrozenMimeForZoho = async (
  rawMime: Uint8Array,
): Promise<ZohoMimeProjection> => {
  const parsed = await parseRawEmail(rawMime, {
    sanitizeHtml: (html) => html,
  });
  const useHtml = parsed.htmlBody.length > 0;
  return {
    subject: parsed.subject,
    content: useHtml ? parsed.htmlBody : parsed.textBody,
    mailFormat: useHtml ? 'html' : 'plaintext',
    attachments: parsed.attachments.map((attachment, index) => ({
      filename: attachment.filename ?? `attachment-${index + 1}`,
      bytes: Uint8Array.from(attachment.bytes),
    })),
  };
};
