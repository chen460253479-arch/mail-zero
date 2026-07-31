export type BodyValueDto = {
  value: string;
  isTruncated: boolean;
};

export function projectBodyValue(value: string, maxBytes: number): BodyValueDto {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return { value, isTruncated: false };
  }
  let result = '';
  let consumed = 0;
  for (const character of value) {
    const length = encoder.encode(character).byteLength;
    if (consumed + length > maxBytes) break;
    consumed += length;
    result += character;
  }
  return { value: result, isTruncated: true };
}
