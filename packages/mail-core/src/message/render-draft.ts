import { Buffer } from 'node:buffer';

import { createMimeMessage, Mailbox } from 'mimetext';

import type { RenderDraftInput } from './draft-types';
import type { MailAddress } from '../types';

const CRLF = '\r\n';

const normalizeCrlf = (value: string): string => value.replace(/\r\n|\r|\n/gu, CRLF);

const mailbox = ({ email, name }: MailAddress): { addr: string; name?: string } => ({
  addr: email,
  ...(name === undefined ? {} : { name }),
});

const dateHeader = (date: Date): string => date.toUTCString().replace(/GMT|UTC/giu, '+0000');

const encodeSubject = (subject: string): string =>
  /^[\x20-\x7e]*$/u.test(subject)
    ? subject
    : `=?utf-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;

export function renderDraft(input: RenderDraftInput): Uint8Array {
  const message = createMimeMessage();
  const sender = new Mailbox({
    addr: input.identity.email,
    ...(input.identity.name === null ? {} : { name: input.identity.name }),
  });
  message.setHeader('From', sender);
  message.setHeader('Sender', sender);
  if (input.identity.replyTo !== null) {
    message.setHeader('Reply-To', new Mailbox(input.identity.replyTo));
  }
  if (input.content.to.length > 0) {
    message.setTo(input.content.to.map(mailbox));
  }
  if (input.content.cc.length > 0) {
    message.setCc(input.content.cc.map(mailbox));
  }
  if (input.content.bcc.length > 0) {
    message.setBcc(input.content.bcc.map(mailbox));
  }
  message.setHeader('Date', dateHeader(input.date));
  message.setHeader('Message-ID', input.messageId);
  message.setSubject(input.content.subject);
  const subjectField = message.headers.fields.find(({ name }) => name === 'Subject');
  if (subjectField !== undefined) {
    subjectField.dump = (value) => (typeof value === 'string' ? encodeSubject(value) : '');
  }
  if (input.inReplyTo.length > 0) {
    message.setHeader('In-Reply-To', input.inReplyTo.join(' '));
  }
  if (input.references.length > 0) {
    message.setHeader('References', input.references.join(' '));
  }
  message.boundaries = {
    mixed: `zero_${input.emailId}_${input.revision}_mixed`,
    alt: `zero_${input.emailId}_${input.revision}_alternative`,
    related: `zero_${input.emailId}_${input.revision}_related`,
  };

  message.addMessage({
    contentType: 'text/plain',
    data: normalizeCrlf(input.content.textBody),
  });
  if (input.content.htmlBody.length > 0) {
    message.addMessage({
      contentType: 'text/html',
      data: normalizeCrlf(input.content.htmlBody),
    });
  }
  for (const attachment of input.attachments) {
    message.addAttachment({
      filename: attachment.id,
      contentType: attachment.contentType,
      data: Buffer.from(attachment.bytes).toString('base64'),
      encoding: 'base64',
    });
  }

  return new TextEncoder().encode(normalizeCrlf(message.asRaw()));
}
