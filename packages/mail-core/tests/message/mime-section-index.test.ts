import { describe, expect, it } from 'vitest';

import {
  decodeMimeSection,
  indexMimeSections,
  MailCoreError,
  type MimeTransferEncoding,
} from '../../src';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const sectionBytes = (
  raw: Uint8Array,
  section: ReturnType<typeof indexMimeSections>[number],
): Uint8Array =>
  raw.slice(
    Number(section.offsetStart),
    Number(section.offsetStart + section.encodedLength),
  );

describe('MIME BlobSection index', () => {
  it('indexes nested multipart leaves in raw byte order', () => {
    const raw = encode(
      [
        'From: sender@example.test',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="outer"',
        '',
        'preamble',
        '--outer',
        'Content-Type: multipart/alternative;',
        ' boundary="inner"',
        '',
        '--inner',
        'Content-Type: text/plain',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Plain=20body',
        '--inner',
        'Content-Type: text/html',
        '',
        '<p>HTML body</p>',
        '--inner--',
        '--outer',
        'Content-Type: application/octet-stream',
        'Content-Disposition: attachment; filename="sample.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        'AQIDBA==',
        '--outer--',
        'epilogue',
      ].join('\r\n'),
    );

    const sections = indexMimeSections(raw);

    expect(
      sections.map(({ partPath, parentPath, contentType, multipart }) => ({
        partPath,
        parentPath,
        contentType,
        multipart,
      })),
    ).toEqual([
      {
        partPath: '1',
        parentPath: null,
        contentType: 'multipart/mixed',
        multipart: true,
      },
      {
        partPath: '1.1',
        parentPath: '1',
        contentType: 'multipart/alternative',
        multipart: true,
      },
      {
        partPath: '1.1.1',
        parentPath: '1.1',
        contentType: 'text/plain',
        multipart: false,
      },
      {
        partPath: '1.1.2',
        parentPath: '1.1',
        contentType: 'text/html',
        multipart: false,
      },
      {
        partPath: '1.2',
        parentPath: '1',
        contentType: 'application/octet-stream',
        multipart: false,
      },
    ]);
    const attachment = sections.at(-1)!;
    expect(new TextDecoder().decode(sectionBytes(raw, attachment))).toBe('AQIDBA==');
    expect(decodeMimeSection(sectionBytes(raw, attachment), attachment.transferEncoding)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(attachment.decodedLength).toBe(4n);
  });

  it.each([
    ['7bit', 'plain ASCII'],
    ['8bit', '邮件正文'],
    ['binary', '\u0000\u0001\u0002'],
  ] satisfies [MimeTransferEncoding, string][])(
    'uses the exact leaf bytes for %s content',
    (transferEncoding, content) => {
      const raw = encode(
        [
          'Content-Type: application/octet-stream',
          `Content-Transfer-Encoding: ${transferEncoding}`,
          '',
          content,
        ].join('\n'),
      );

      const [section] = indexMimeSections(raw);
      const encoded = sectionBytes(raw, section!);

      expect(decodeMimeSection(encoded, transferEncoding)).toEqual(encode(content));
      expect(section?.decodedLength).toBe(BigInt(encode(content).byteLength));
    },
  );

  it('decodes quoted-printable soft line breaks without changing its raw range', () => {
    const raw = encode(
      [
        'Content-Type: text/plain',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'first=20line=\r',
        'second=3Dline',
      ].join('\n'),
    );
    const [section] = indexMimeSections(raw);
    const encoded = sectionBytes(raw, section!);

    expect(new TextDecoder().decode(encoded)).toBe('first=20line=\r\nsecond=3Dline');
    expect(new TextDecoder().decode(decodeMimeSection(encoded, 'quoted-printable'))).toBe(
      'first linesecond=line',
    );
  });

  it('rejects malformed base64 padding instead of indexing unverifiable content', () => {
    expect(() =>
      indexMimeSections(
        encode(
          [
            'Content-Type: application/octet-stream',
            'Content-Transfer-Encoding: base64',
            '',
            'TQ===',
          ].join('\r\n'),
        ),
      ),
    ).toThrowError(expect.objectContaining<Partial<MailCoreError>>({ code: 'MIME_PARSE_FAILED' }));
  });

  it('rejects a multipart entity without a closing boundary', () => {
    expect(() =>
      indexMimeSections(
        encode(
          [
            'Content-Type: multipart/mixed; boundary="missing-close"',
            '',
            '--missing-close',
            'Content-Type: text/plain',
            '',
            'body',
          ].join('\r\n'),
        ),
      ),
    ).toThrowError(expect.objectContaining<Partial<MailCoreError>>({ code: 'MIME_PARSE_FAILED' }));
  });
});
