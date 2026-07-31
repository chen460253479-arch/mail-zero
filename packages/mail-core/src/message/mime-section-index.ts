import { MailCoreError } from '../types';
import type { BlobSection, MimeTransferEncoding } from './types';

export type IndexedMimeSection = BlobSection & {
  partPath: string;
  parentPath: string | null;
  contentType: string;
  multipart: boolean;
};

type HeaderBlock = {
  bodyStart: number;
  headers: Map<string, string>;
};

type BoundaryLine = {
  start: number;
  next: number;
  closing: boolean;
};

const ASCII_CR = 13;
const ASCII_LF = 10;
const ASCII_SPACE = 32;
const ASCII_TAB = 9;
const ASCII_EQUALS = 61;
const decoder = new TextDecoder('latin1');

const mimeFailure = (): never => {
  throw new MailCoreError('MIME_PARSE_FAILED');
};

const isLinearWhitespace = (byte: number): boolean =>
  byte === ASCII_SPACE || byte === ASCII_TAB;

const readLine = (
  raw: Uint8Array,
  start: number,
  end: number,
): { contentEnd: number; next: number } => {
  let cursor = start;
  while (cursor < end && raw[cursor] !== ASCII_CR && raw[cursor] !== ASCII_LF) {
    cursor += 1;
  }
  const contentEnd = cursor;
  if (cursor >= end) {
    return { contentEnd, next: end };
  }
  if (raw[cursor] === ASCII_CR && cursor + 1 < end && raw[cursor + 1] === ASCII_LF) {
    return { contentEnd, next: cursor + 2 };
  }
  return { contentEnd, next: cursor + 1 };
};

const parseHeaderBlock = (raw: Uint8Array, start: number, end: number): HeaderBlock => {
  const physicalLines: string[] = [];
  let cursor = start;
  let bodyStart = -1;
  while (cursor <= end) {
    const line = readLine(raw, cursor, end);
    if (line.contentEnd === cursor) {
      bodyStart = line.next;
      break;
    }
    physicalLines.push(decoder.decode(raw.subarray(cursor, line.contentEnd)));
    if (line.next === end) break;
    cursor = line.next;
  }
  if (bodyStart < 0 || bodyStart > end) {
    return mimeFailure();
  }

  const unfolded: string[] = [];
  for (const line of physicalLines) {
    if (/^[\t ]/u.test(line)) {
      if (unfolded.length === 0) return mimeFailure();
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }

  const headers = new Map<string, string>();
  for (const line of unfolded) {
    const separator = line.indexOf(':');
    if (separator <= 0) return mimeFailure();
    const name = line.slice(0, separator).trim().toLocaleLowerCase('und');
    const value = line.slice(separator + 1).trim();
    const previous = headers.get(name);
    headers.set(name, previous === undefined ? value : `${previous}, ${value}`);
  }
  return { bodyStart, headers };
};

const splitParameters = (value: string): string[] => {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ';') {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted || escaped) return mimeFailure();
  result.push(value.slice(start));
  return result;
};

const unquoteParameter = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  if (!trimmed.endsWith('"') || trimmed.length < 2) return mimeFailure();
  let result = '';
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const character = trimmed[index]!;
    if (character === '\\') {
      index += 1;
      if (index >= trimmed.length - 1) return mimeFailure();
      result += trimmed[index]!;
    } else {
      result += character;
    }
  }
  return result;
};

const parseContentType = (
  value: string | undefined,
): { value: string; boundary: string | null } => {
  if (value === undefined || value.trim() === '') {
    return { value: 'text/plain', boundary: null };
  }
  const [rawType, ...rawParameters] = splitParameters(value);
  const contentType = rawType?.trim().toLocaleLowerCase('und') ?? '';
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(contentType)) {
    return mimeFailure();
  }
  let boundary: string | null = null;
  for (const rawParameter of rawParameters) {
    const separator = rawParameter.indexOf('=');
    if (separator <= 0) continue;
    const name = rawParameter.slice(0, separator).trim().toLocaleLowerCase('und');
    if (name !== 'boundary') continue;
    boundary = unquoteParameter(rawParameter.slice(separator + 1));
  }
  return { value: contentType, boundary };
};

const parseTransferEncoding = (value: string | undefined): MimeTransferEncoding => {
  const normalized = value?.trim().toLocaleLowerCase('und') || '7bit';
  if (
    normalized === '7bit' ||
    normalized === '8bit' ||
    normalized === 'binary' ||
    normalized === 'base64' ||
    normalized === 'quoted-printable'
  ) {
    return normalized;
  }
  return mimeFailure();
};

const decodeBase64 = (encoded: Uint8Array): Uint8Array => {
  const values: number[] = [];
  let paddingStarted = false;
  let paddingCount = 0;
  for (const byte of encoded) {
    if (byte === ASCII_SPACE || byte === ASCII_TAB || byte === ASCII_CR || byte === ASCII_LF) {
      continue;
    }
    if (byte === ASCII_EQUALS) {
      paddingStarted = true;
      paddingCount += 1;
      continue;
    }
    if (paddingStarted) return mimeFailure();
    if (byte >= 65 && byte <= 90) values.push(byte - 65);
    else if (byte >= 97 && byte <= 122) values.push(byte - 97 + 26);
    else if (byte >= 48 && byte <= 57) values.push(byte - 48 + 52);
    else if (byte === 43) values.push(62);
    else if (byte === 47) values.push(63);
    else return mimeFailure();
  }
  if (paddingCount > 2) return mimeFailure();
  if (
    paddingCount > 0 &&
    ((values.length + paddingCount) % 4 !== 0 ||
      (paddingCount === 1 && values.length % 4 !== 3) ||
      (paddingCount === 2 && values.length % 4 !== 2))
  ) {
    return mimeFailure();
  }
  if (values.length % 4 === 1) return mimeFailure();
  const output: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const value of values) {
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >> bits) & 0xff);
    }
  }
  return Uint8Array.from(output);
};

const hexadecimalValue = (byte: number): number => {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 65 + 10;
  if (byte >= 97 && byte <= 102) return byte - 97 + 10;
  return -1;
};

const decodeQuotedPrintable = (encoded: Uint8Array): Uint8Array => {
  const output: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    const byte = encoded[index]!;
    if (byte !== ASCII_EQUALS) {
      output.push(byte);
      continue;
    }
    const next = encoded[index + 1];
    if (next === ASCII_CR && encoded[index + 2] === ASCII_LF) {
      index += 2;
      continue;
    }
    if (next === ASCII_LF) {
      index += 1;
      continue;
    }
    if (next === undefined || encoded[index + 2] === undefined) return mimeFailure();
    const high = hexadecimalValue(next);
    const low = hexadecimalValue(encoded[index + 2]!);
    if (high < 0 || low < 0) return mimeFailure();
    output.push((high << 4) | low);
    index += 2;
  }
  return Uint8Array.from(output);
};

export const decodeMimeSection = (
  encoded: Uint8Array,
  transferEncoding: MimeTransferEncoding,
): Uint8Array => {
  switch (transferEncoding) {
    case 'base64':
      return decodeBase64(encoded);
    case 'quoted-printable':
      return decodeQuotedPrintable(encoded);
    case '7bit':
    case '8bit':
    case 'binary':
      return Uint8Array.from(encoded);
  }
};

const boundaryLine = (
  raw: Uint8Array,
  lineStart: number,
  contentEnd: number,
  next: number,
  boundary: Uint8Array,
): BoundaryLine | null => {
  if (contentEnd - lineStart < boundary.length + 2) return null;
  if (raw[lineStart] !== 45 || raw[lineStart + 1] !== 45) return null;
  for (let index = 0; index < boundary.length; index += 1) {
    if (raw[lineStart + 2 + index] !== boundary[index]) return null;
  }
  let cursor = lineStart + 2 + boundary.length;
  let closing = false;
  if (raw[cursor] === 45 && raw[cursor + 1] === 45) {
    closing = true;
    cursor += 2;
  }
  while (cursor < contentEnd && isLinearWhitespace(raw[cursor]!)) cursor += 1;
  return cursor === contentEnd ? { start: lineStart, next, closing } : null;
};

const findBoundaryLines = (
  raw: Uint8Array,
  start: number,
  end: number,
  boundaryValue: string,
): BoundaryLine[] => {
  if (boundaryValue.length === 0 || boundaryValue.length > 70) return mimeFailure();
  const boundary = new TextEncoder().encode(boundaryValue);
  const result: BoundaryLine[] = [];
  let cursor = start;
  while (cursor < end) {
    const line = readLine(raw, cursor, end);
    const matched = boundaryLine(raw, cursor, line.contentEnd, line.next, boundary);
    if (matched !== null) result.push(matched);
    if (line.next === end) break;
    cursor = line.next;
  }
  return result;
};

const trimLineBreakBefore = (raw: Uint8Array, position: number, floor: number): number => {
  if (position > floor && raw[position - 1] === ASCII_LF) {
    return position - 2 >= floor && raw[position - 2] === ASCII_CR ? position - 2 : position - 1;
  }
  if (position > floor && raw[position - 1] === ASCII_CR) return position - 1;
  return position;
};

export const indexMimeSections = (rawInput: Uint8Array): IndexedMimeSection[] => {
  const raw = Uint8Array.from(rawInput);
  const result: IndexedMimeSection[] = [];

  const indexEntity = (
    start: number,
    end: number,
    partPath: string,
    parentPath: string | null,
  ): void => {
    if (start < 0 || end < start || end > raw.length) return mimeFailure();
    const { bodyStart, headers } = parseHeaderBlock(raw, start, end);
    const contentType = parseContentType(headers.get('content-type'));
    const transferEncoding = parseTransferEncoding(headers.get('content-transfer-encoding'));
    const multipart = contentType.value.startsWith('multipart/');
    if (multipart && transferEncoding !== '7bit' && transferEncoding !== '8bit') {
      return mimeFailure();
    }
    const encoded = raw.subarray(bodyStart, end);
    const decoded = decodeMimeSection(encoded, transferEncoding);
    result.push({
      partPath,
      parentPath,
      contentType: contentType.value,
      multipart,
      offsetStart: BigInt(bodyStart),
      encodedLength: BigInt(encoded.byteLength),
      decodedLength: BigInt(decoded.byteLength),
      transferEncoding,
    });

    if (!multipart) return;
    if (contentType.boundary === null) return mimeFailure();
    const boundaries = findBoundaryLines(raw, bodyStart, end, contentType.boundary);
    const firstOpening = boundaries.findIndex(({ closing }) => !closing);
    if (firstOpening < 0) return mimeFailure();
    let childStart = boundaries[firstOpening]!.next;
    let childIndex = 1;
    let closed = false;
    for (let index = firstOpening + 1; index < boundaries.length; index += 1) {
      const boundary = boundaries[index]!;
      const childEnd = trimLineBreakBefore(raw, boundary.start, childStart);
      if (childEnd <= childStart) return mimeFailure();
      indexEntity(childStart, childEnd, `${partPath}.${childIndex}`, partPath);
      childIndex += 1;
      if (boundary.closing) {
        closed = true;
        break;
      }
      childStart = boundary.next;
    }
    if (!closed) return mimeFailure();
  };

  indexEntity(0, raw.length, '1', null);
  return result;
};
