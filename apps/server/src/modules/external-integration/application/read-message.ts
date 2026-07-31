import {
  MailCoreError,
  type EmailId,
  type EmailRecord,
  type MailAccountId,
  type MailCore,
} from '@zero/mail-core';

import type {
  ExternalAttachment,
  ExternalMessageContent,
  ExternalMessageSummary,
} from '../contracts/message';
import type { MailChannelId } from '../../../mail-channel/contracts';
import { ExternalIntegrationError } from '../errors';

export type ExternalMessageScope = {
  mailAccountId: MailAccountId;
  userId: string;
  nangoConnectionId: string;
  channelId: MailChannelId;
};

export type ExternalAttachmentScope = {
  mailAccountId: MailAccountId;
  emailId: EmailId;
  partId: string;
};

export interface ExternalMessageRepository {
  findMessageScope(input: { messageId: string }): Promise<ExternalMessageScope | null>;
  findAttachmentScope(input: { attachmentId: string }): Promise<ExternalAttachmentScope | null>;
}

type ExternalMessageReaderDependencies = {
  repository: ExternalMessageRepository;
  core: Pick<MailCore, 'getEmail' | 'readEmailPart'>;
};

const attachmentParts = (email: EmailRecord) =>
  email.parts.filter(({ kind }) => kind === 'attachment' || kind === 'inline');

const hasBodyPart = (email: EmailRecord, contentType: string) =>
  email.parts.some(
    (part) =>
      part.kind === 'body' && part.contentType.toLocaleLowerCase('und').startsWith(contentType),
  );

export const createExternalMessageReader = (dependencies: ExternalMessageReaderDependencies) => {
  const getScopedEmail = async (
    messageId: string,
  ): Promise<{
    scope: ExternalMessageScope;
    email: EmailRecord;
  }> => {
    const scope = await dependencies.repository.findMessageScope({
      messageId,
    });
    if (scope === null) {
      throw new ExternalIntegrationError('MESSAGE_NOT_FOUND');
    }
    try {
      const email = await dependencies.core.getEmail({
        accountId: scope.mailAccountId,
        emailId: messageId as EmailId,
      });
      return { scope, email };
    } catch (error) {
      if (
        error instanceof MailCoreError &&
        (error.code === 'EMAIL_NOT_FOUND' ||
          error.code === 'ACCOUNT_NOT_FOUND' ||
          error.code === 'CROSS_ACCOUNT_REFERENCE')
      ) {
        throw new ExternalIntegrationError('MESSAGE_NOT_FOUND');
      }
      throw error;
    }
  };

  return {
    async getSummary(messageId: string): Promise<ExternalMessageSummary> {
      const { scope, email } = await getScopedEmail(messageId);
      return {
        messageId: email.id,
        internetMessageId: email.messageId,
        threadId: email.threadId,
        mailAccountId: scope.mailAccountId,
        nangoConnectionId: scope.nangoConnectionId,
        channelId: scope.channelId,
        lifecycle: email.lifecycle,
        mailboxIds: [...email.mailboxIds],
        keywords: [...email.keywords],
        subject: email.subject,
        preview: email.preview,
        sender: email.sender,
        from: email.from,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        sentAt: email.sentAt?.toISOString() ?? null,
        receivedAt: email.receivedAt.toISOString(),
        hasAttachment: email.hasAttachment,
        attachmentCount: attachmentParts(email).length,
      };
    },

    async getContent(messageId: string): Promise<ExternalMessageContent> {
      const { email } = await getScopedEmail(messageId);
      return {
        messageId: email.id,
        textBody: hasBodyPart(email, 'text/plain') ? email.textBody : null,
        htmlBody: hasBodyPart(email, 'text/html') ? email.htmlBody : null,
      };
    },

    async listAttachments(messageId: string): Promise<ExternalAttachment[]> {
      const { email } = await getScopedEmail(messageId);
      return attachmentParts(email).map((part) => ({
        attachmentId: part.id,
        filename: part.filename,
        contentType: part.contentType,
        disposition: part.disposition,
        size: part.sizeBytes.toString(),
      }));
    },

    async getAttachmentContent(attachmentId: string): Promise<{
      bytes: Uint8Array;
      filename: string | null;
      contentType: string;
      size: string;
    }> {
      const scope = await dependencies.repository.findAttachmentScope({
        attachmentId,
      });
      if (scope === null) {
        throw new ExternalIntegrationError('ATTACHMENT_NOT_FOUND');
      }
      try {
        const part = await dependencies.core.readEmailPart({
          accountId: scope.mailAccountId,
          emailId: scope.emailId,
          partId: scope.partId,
        });
        return {
          bytes: part.bytes,
          filename: part.filename,
          contentType: part.contentType,
          size: part.sizeBytes.toString(),
        };
      } catch (error) {
        if (
          error instanceof MailCoreError &&
          (error.code === 'BLOB_NOT_FOUND' ||
            error.code === 'ACCOUNT_NOT_FOUND' ||
            error.code === 'CROSS_ACCOUNT_REFERENCE')
        ) {
          throw new ExternalIntegrationError('ATTACHMENT_NOT_FOUND');
        }
        throw error;
      }
    },
  };
};

export type ExternalMessageReader = ReturnType<typeof createExternalMessageReader>;
