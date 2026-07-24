import { fromByteArray, toByteArray } from 'base64-js';

type EncryptedEnvelope = {
  version: 1;
  iv: string;
  ciphertext: string;
};

const decodeKey = (encodedKey: string): Uint8Array => {
  try {
    const key = toByteArray(encodedKey);
    if (key.byteLength === 32) return key;
  } catch {
    // Report one stable configuration error below.
  }
  throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
};

const importKey = async (encodedKey: string): Promise<CryptoKey> =>
  await crypto.subtle.importKey(
    'raw',
    decodeKey(encodedKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );

export const encryptCredential = async (value: unknown, encodedKey: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importKey(encodedKey),
    plaintext,
  );
  const envelope: EncryptedEnvelope = {
    version: 1,
    iv: fromByteArray(iv),
    ciphertext: fromByteArray(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope);
};

export const decryptCredential = async <T = unknown>(
  payload: string,
  encodedKey: string,
): Promise<T> => {
  const envelope = JSON.parse(payload) as Partial<EncryptedEnvelope>;
  if (
    envelope.version !== 1 ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('Unsupported encrypted credential envelope');
  }

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toByteArray(envelope.iv) },
    await importKey(encodedKey),
    toByteArray(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
};
