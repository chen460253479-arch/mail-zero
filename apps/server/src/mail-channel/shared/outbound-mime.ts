const findHeaderBoundary = (
  rawMime: Uint8Array,
): { index: number; lineEnding: '\r\n' | '\n' } | null => {
  for (let index = 0; index < rawMime.byteLength - 3; index += 1) {
    if (
      rawMime[index] === 13 &&
      rawMime[index + 1] === 10 &&
      rawMime[index + 2] === 13 &&
      rawMime[index + 3] === 10
    ) {
      return { index, lineEnding: '\r\n' };
    }
  }
  for (let index = 0; index < rawMime.byteLength - 1; index += 1) {
    if (rawMime[index] === 10 && rawMime[index + 1] === 10) {
      return { index, lineEnding: '\n' };
    }
  }
  return null;
};

const requireSafeRecipient = (value: string): string => {
  const recipient = value.trim();
  if (
    recipient.length === 0 ||
    recipient !== value ||
    /[\u0000-\u001f\u007f]/u.test(recipient)
  ) {
    throw new Error('Invalid outbound Bcc recipient');
  }
  return recipient;
};

const concatenate = (...parts: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

export const addTransientBccHeader = (
  rawMime: Uint8Array,
  recipients: readonly string[],
): Uint8Array => {
  if (recipients.length === 0) return rawMime;
  const boundary = findHeaderBoundary(rawMime);
  if (boundary === null) throw new Error('Invalid outbound MIME');

  const headerBlock = new TextDecoder('latin1').decode(rawMime.slice(0, boundary.index));
  if (/^bcc\s*:/imu.test(headerBlock)) {
    throw new Error('Stored outbound MIME must not contain a Bcc header');
  }

  const bcc = recipients.map(requireSafeRecipient);
  const separator = `,${boundary.lineEnding} `;
  const transientHeader = new TextEncoder().encode(
    `${boundary.lineEnding}Bcc: ${bcc.join(separator)}`,
  );
  return concatenate(
    rawMime.slice(0, boundary.index),
    transientHeader,
    rawMime.slice(boundary.index),
  );
};
