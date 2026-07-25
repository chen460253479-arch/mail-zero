import type { EmailSearchDocument } from '../store';
import type { MailAddress } from '../types';

const normalize = (value: string): string => value.trim().normalize('NFC').toLocaleLowerCase('und');

const stripHtml = (html: string): string =>
  html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

export const createEmailSearchDocument = (input: {
  subject: string;
  addresses: MailAddress[];
  textBody: string;
  htmlBody: string;
  sanitizeHtml?: (html: string) => string;
}): EmailSearchDocument => ({
  subject: normalize(input.subject),
  addressText: normalize(
    input.addresses.flatMap(({ email, name }) => [name ?? '', email]).join(' '),
  ),
  bodyText: normalize(
    input.textBody.length > 0
      ? input.textBody
      : stripHtml(input.sanitizeHtml?.(input.htmlBody) ?? input.htmlBody),
  ),
});
