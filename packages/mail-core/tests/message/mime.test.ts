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
      parsed.parts.map(({ partPath, parentPath, contentType, kind }) => ({
        partPath,
        parentPath,
        contentType,
        kind,
      })),
    ).toEqual([
      {
        partPath: '1',
        parentPath: null,
        contentType: 'multipart/mixed',
        kind: 'body',
      },
      {
        partPath: '1.1',
        parentPath: '1',
        contentType: 'multipart/related',
        kind: 'body',
      },
      {
        partPath: '1.1.1',
        parentPath: '1.1',
        contentType: 'text/html',
        kind: 'body',
      },
      {
        partPath: '1.1.2',
        parentPath: '1.1',
        contentType: 'image/png',
        kind: 'inline',
      },
      {
        partPath: '1.2',
        parentPath: '1',
        contentType: 'application/octet-stream',
        kind: 'attachment',
      },
    ]);
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

  it('retains each body leaf from its own MIME node instead of duplicating the aggregate body', async () => {
    const raw = new TextEncoder().encode(
      [
        'From: sender@example.test',
        'To: recipient@example.test',
        'Subject: Multiple body leaves',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="body-parts"',
        '',
        '--body-parts',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'First body.',
        '--body-parts',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Second body.',
        '--body-parts--',
        '',
      ].join('\r\n'),
    );

    const parsed = await parseRawEmail(raw, {
      sanitizeHtml: (html) => html,
    });
    const decoder = new TextDecoder();
    expect(
      parsed.parts
        .filter(({ contentType }) => contentType === 'text/plain')
        .map(({ bytes }) => decoder.decode(bytes)),
    ).toEqual(['First body.', 'Second body.']);
  });

  it('maps every parsed MIME part to its immutable raw byte section', async () => {
    const source = [
      'From: sender@example.test',
      'To: recipient@example.test',
      'Subject: Section fixture',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hello=20section=21',
    ].join('\r\n');
    const raw = new TextEncoder().encode(source);

    const parsed = await parseRawEmail(raw, {
      sanitizeHtml: (html) => html,
    });

    const section = parsed.parts[0]?.section;
    expect(section).toEqual({
      offsetStart: BigInt(source.indexOf('Hello=20section=21')),
      encodedLength: 18n,
      decodedLength: 14n,
      transferEncoding: 'quoted-printable',
    });
    expect(
      new TextDecoder().decode(
        raw.slice(
          Number(section?.offsetStart),
          Number((section?.offsetStart ?? 0n) + (section?.encodedLength ?? 0n)),
        ),
      ),
    ).toBe('Hello=20section=21');
  });
});
