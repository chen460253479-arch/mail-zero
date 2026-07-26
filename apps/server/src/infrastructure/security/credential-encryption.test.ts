import { describe, expect, it } from 'vitest';

import { decryptCredential, encryptCredential } from './credential-encryption';

const key = Buffer.alloc(32, 7).toString('base64');

describe('credential encryption', () => {
  it('round-trips a credential without exposing plaintext', async () => {
    const encrypted = await encryptCredential({ accessToken: 'secret' }, key);
    expect(encrypted).not.toContain('secret');
    await expect(decryptCredential(encrypted, key)).resolves.toEqual({
      accessToken: 'secret',
    });
  });

  it('rejects keys that are not 32 bytes', async () => {
    await expect(encryptCredential({ value: 'x' }, 'bad')).rejects.toThrow(
      'CREDENTIAL_ENCRYPTION_KEY',
    );
  });
});
