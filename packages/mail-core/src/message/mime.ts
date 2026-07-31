import PostalMime, { decodeWords, type Address, type Mailbox } from 'postal-mime';

import type { ParsedEmail, ParsedPart, ParseRawEmailDependencies } from './types';
import { MailCoreError, type MailAddress } from '../types';
import { indexMimeSections } from './mime-section-index';
import { normalizeMessageId } from '../thread';

const toMailAddress = (mailbox: Mailbox): MailAddress => ({
  ...(mailbox.name === '' ? {} : { name: mailbox.name }),
  email: mailbox.address,
});

const flattenAddress = (address: Address): MailAddress[] =>
  address.group === undefined ? [toMailAddress(address)] : address.group.map(toMailAddress);

const normalizeAddresses = (addresses: Address | Address[] | undefined): MailAddress[] => {
  if (addresses === undefined) {
    return [];
  }
  return (Array.isArray(addresses) ? addresses : [addresses]).flatMap(flattenAddress);
};

const splitMessageIds = (value: string | undefined): string[] => {
  if (value === undefined) {
    return [];
  }
  const bracketed = [...value.matchAll(/<([^<>]+)>/gu)].map((match) => match[1]!);
  const candidates = bracketed.length > 0 ? bracketed : value.split(/\s+/gu).filter(Boolean);

  return Array.from(
    new Set(candidates.map(normalizeMessageId).filter((candidate) => candidate.length > 0)),
  );
};

const toBytes = (content: ArrayBuffer | Uint8Array): Uint8Array => {
  return content instanceof Uint8Array
    ? Uint8Array.from(content)
    : new Uint8Array(content.slice(0));
};

const classifyAttachment = (
  attachment: Pick<ParsedPart, 'disposition' | 'related'>,
): ParsedPart['kind'] =>
  attachment.disposition === 'attachment'
    ? 'attachment'
    : attachment.disposition === 'inline' || attachment.related === true
      ? 'inline'
      : 'attachment';

type MimeNodeView = {
  childNodes: MimeNodeView[];
  content: ArrayBuffer | Uint8Array | null;
  contentId?: string;
  contentType: {
    multipart?: string | false;
    parsed: { value: string; params: Record<string, string | undefined> };
  };
  contentDisposition?: {
    parsed?: { value?: string | false; params?: Record<string, string | undefined> };
  };
  getTextContent(): string;
};

type SemanticParsedPart = Omit<ParsedPart, 'section'>;

const extractParts = (
  root: MimeNodeView,
  sanitizeHtml: (html: string) => string,
): SemanticParsedPart[] => {
  const walk = (
    node: MimeNodeView,
    partPath: string,
    parentPath: string | null,
    related: boolean,
  ): SemanticParsedPart[] => {
    const contentType = node.contentType.parsed.value.toLocaleLowerCase('und');
    const dispositionValue = node.contentDisposition?.parsed?.value;
    const disposition =
      dispositionValue === 'inline' || dispositionValue === 'attachment' ? dispositionValue : null;
    const isMultipart =
      node.contentType.multipart !== undefined && node.contentType.multipart !== false;
    const isBody =
      isMultipart ||
      (disposition !== 'attachment' &&
        (contentType === 'text/plain' || contentType === 'text/html'));
    const bodyText = isBody
      ? (contentType === 'text/html'
          ? sanitizeHtml(node.getTextContent())
          : node.getTextContent()
        ).trimEnd()
      : '';
    const bytes = isMultipart
      ? new Uint8Array()
      : isBody
        ? new TextEncoder().encode(bodyText)
        : node.content === null
          ? new Uint8Array()
          : toBytes(node.content);
    const filenameValue =
      node.contentDisposition?.parsed?.params?.filename ?? node.contentType.parsed.params.name;
    const part: SemanticParsedPart = {
      parentPath,
      partPath,
      contentType,
      charset: node.contentType.parsed.params.charset ?? null,
      disposition,
      related,
      kind: isBody ? 'body' : classifyAttachment({ disposition, related }),
      filename: filenameValue === undefined ? null : decodeWords(filenameValue),
      contentId: node.contentId ?? null,
      bytes,
      sizeBytes: BigInt(bytes.byteLength),
    };
    const childRelated = related || node.contentType.multipart === 'related';
    return [
      part,
      ...node.childNodes.flatMap((child, index) =>
        walk(child, `${partPath}.${index + 1}`, partPath, childRelated),
      ),
    ];
  };
  return walk(root, '1', null, false);
};

const toDate = (value: string | undefined): Date | null => {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export async function parseRawEmail(
  raw: Uint8Array,
  dependencies: ParseRawEmailDependencies,
): Promise<ParsedEmail> {
  try {
    const parser = new PostalMime({
      attachmentEncoding: 'arraybuffer',
    });
    const parsed = await parser.parse(Uint8Array.from(raw));
    const sanitizedHtml = new Map<string, string>();
    const sanitizeHtml = (html: string): string => {
      const existing = sanitizedHtml.get(html);
      if (existing !== undefined) {
        return existing;
      }
      const sanitized = dependencies.sanitizeHtml(html);
      sanitizedHtml.set(html, sanitized);
      return sanitized;
    };
    const htmlBody = parsed.html === undefined ? '' : sanitizeHtml(parsed.html).trimEnd();
    const textBody = parsed.text?.trimEnd() ?? '';
    // PostalMime intentionally keeps the parsed node tree internal. The adapter
    // is pinned to its runtime shape here so persistence can retain MIME paths
    // and parent relationships instead of flattening every part.
    const semanticParts = extractParts(
      (parser as unknown as { root: MimeNodeView }).root,
      sanitizeHtml,
    );
    const sectionByPath = new Map(
      indexMimeSections(raw).map((section) => [section.partPath, section]),
    );
    const parts = semanticParts.map((part): ParsedPart => {
      const section = sectionByPath.get(part.partPath);
      if (
        section === undefined ||
        section.parentPath !== part.parentPath ||
        section.contentType !== part.contentType
      ) {
        throw new MailCoreError('MIME_PARSE_FAILED');
      }
      return {
        ...part,
        section: {
          offsetStart: section.offsetStart,
          encodedLength: section.encodedLength,
          decodedLength: section.decodedLength,
          transferEncoding: section.transferEncoding,
        },
      };
    });
    if (sectionByPath.size !== parts.length) {
      throw new MailCoreError('MIME_PARSE_FAILED');
    }
    const attachments = parts.filter(
      (part): part is ParsedPart & { kind: 'inline' | 'attachment' } => part.kind !== 'body',
    );

    return {
      messageId: splitMessageIds(parsed.messageId)[0] ?? null,
      inReplyTo: splitMessageIds(parsed.inReplyTo),
      references: splitMessageIds(parsed.references),
      subject: parsed.subject ?? '',
      sentAt: toDate(parsed.date),
      from: normalizeAddresses(parsed.from),
      sender: normalizeAddresses(parsed.sender),
      replyTo: normalizeAddresses(parsed.replyTo),
      to: normalizeAddresses(parsed.to),
      cc: normalizeAddresses(parsed.cc),
      bcc: normalizeAddresses(parsed.bcc),
      textBody,
      htmlBody,
      parts,
      attachments,
      hasAttachment: attachments.some(({ kind }) => kind === 'attachment'),
    };
  } catch (error) {
    if (error instanceof MailCoreError) {
      throw new MailCoreError(error.code);
    }
    throw new MailCoreError('MIME_PARSE_FAILED');
  }
}
