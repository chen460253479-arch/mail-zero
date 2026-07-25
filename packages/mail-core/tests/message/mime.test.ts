import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseRawEmail } from '../../src';

const readFixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

describe('parseRawEmail', () => {
  it('normalizes a plain RFC 5322 message without changing its input bytes', async () => {
    const raw = readFixture('simple.eml');
    const original = Uint8Array.from(raw);

    const parsed = await parseRawEmail(raw, {
      sanitizeHtml: () => {
        throw new Error('plain messages have no HTML to sanitize');
      },
    });

    expect(parsed).toMatchObject({
      messageId: 'simple-message@example.test',
      inReplyTo: [],
      references: [],
      subject: 'Simple fixture',
      sentAt: new Date('2026-01-01T10:00:00.000Z'),
      from: [{ name: 'Simple Sender', email: 'sender@example.test' }],
      to: [{ name: 'Simple Recipient', email: 'recipient@example.test' }],
      textBody: 'Hello from the simple fixture.',
      htmlBody: '',
      attachments: [],
      hasAttachment: false,
    });
    expect(raw).toEqual(original);
  });

  it('sanitizes HTML through the injected dependency and copies attachment bytes', async () => {
    const raw = readFixture('multipart.eml');
    const sanitizedInputs: string[] = [];

    const parsed = await parseRawEmail(raw, {
      sanitizeHtml: (html) => {
        sanitizedInputs.push(html);
        return html.replace('<img src="cid:pixel@example.test">', '');
      },
    });

    expect(sanitizedInputs).toHaveLength(1);
    expect(sanitizedInputs[0]).toContain('<p>Hello</p>');
    expect(parsed).toMatchObject({
      messageId: 'multipart-message@example.test',
      inReplyTo: ['root-message@example.test'],
      references: ['root-message@example.test', 'prior-message@example.test'],
      subject: 'Multipart fixture',
      from: [{ name: 'Fixture Sender', email: 'sender@example.test' }],
      replyTo: [{ name: 'Replies', email: 'replies@example.test' }],
      to: [{ name: 'Fixture Recipient', email: 'recipient@example.test' }],
      hasAttachment: true,
    });
    expect(parsed.htmlBody).toContain('<p>Hello</p>');
    expect(parsed.htmlBody).not.toContain('<img');
    expect(
      parsed.attachments.map(({ contentId, contentType, disposition, filename, sizeBytes }) => ({
        contentId,
        contentType,
        disposition,
        filename,
        sizeBytes,
      })),
    ).toEqual([
      {
        contentId: '<pixel@example.test>',
        contentType: 'image/png',
        disposition: 'inline',
        filename: 'pixel.png',
        sizeBytes: 4n,
      },
      {
        contentId: null,
        contentType: 'application/octet-stream',
        disposition: 'attachment',
        filename: 'sample.bin',
        sizeBytes: 4n,
      },
    ]);
    expect(parsed.attachments[0]?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(parsed.attachments[1]?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(parsed.attachments[0]?.bytes).not.toBe(parsed.attachments[1]?.bytes);
  });

  it('classifies a related CID part without Content-Disposition as inline consistently', async () => {
    const parsed = await parseRawEmail(readFixture('related-no-disposition.eml'), {
      sanitizeHtml: (html) => html,
    });

    expect(parsed.hasAttachment).toBe(false);
    expect(parsed.attachments).toEqual([
      expect.objectContaining({
        contentId: '<related-image@example.test>',
        disposition: null,
        kind: 'inline',
        related: true,
      }),
    ]);
  });
});
