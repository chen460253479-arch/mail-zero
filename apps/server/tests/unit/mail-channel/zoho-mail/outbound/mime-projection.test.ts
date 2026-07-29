import { describe, expect, it } from 'vitest';

import { projectFrozenMimeForZoho } from '../../../../../src/mail-channel/zoho-mail/outbound/mime-projection';

describe('Zoho frozen MIME projection', () => {
  it('returns attachment bytes from MIME and never accepts remote attachment URLs', async () => {
    const raw = new TextEncoder().encode(
      [
        'Message-ID: <stable@example.test>',
        'From: sender@example.test',
        'To: recipient@example.test',
        'Subject: Attachment',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="b"',
        '',
        '--b',
        'Content-Type: text/plain',
        '',
        'Body',
        '--b',
        'Content-Type: application/octet-stream',
        'Content-Disposition: attachment; filename="file.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        'AP8B',
        '--b--',
      ].join('\r\n'),
    );

    await expect(projectFrozenMimeForZoho(raw)).resolves.toMatchObject({
      subject: 'Attachment',
      content: 'Body',
      mailFormat: 'plaintext',
      attachments: [
        {
          filename: 'file.bin',
          bytes: new Uint8Array([0, 255, 1]),
        },
      ],
    });
  });
});
