import {
  MailCoreError,
  type BlobId,
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
  blobId: BlobId;
  filename: string | null;
  contentType: string;
  sizeBytes: bigint;
};

export interface ExternalMessageRepository {
  findMessageScope(input: { messageId: string }): Promise<ExternalMessageScope | null>;
  findAttachmentScope(input: { attachmentId: string }): Promise<ExternalAttachmentScope | null>;
}

type ExternalMessageReaderDependencies = {
  repository: ExternalMessageRepository;
  core: Pick<MailCore, 'getEmail' | 'getBlob' | 'readBlob'>;
};

const attachmentParts = (email: EmailRecord) =>
  email.parts.filter(({ kind }) => kind === 'attachment' || kind === 'inline');

const readUtf8Blob = async (
  dependencies: ExternalMessageReaderDependencies,
  accountId: MailAccountId,
  blobId: BlobId | null,
): Promise<string | null> => {
  if (blobId === null) return null;
  const bytes = await dependencies.core.readBlob({
    accountId,
    blobId,
  });
  return new TextDecoder().decode(bytes);
};

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
      const { scope, email } = await getScopedEmail(messageId);
      const [textBody, htmlBody] = await Promise.all([
        readUtf8Blob(dependencies, scope.mailAccountId, email.textBlobId),
        readUtf8Blob(dependencies, scope.mailAccountId, email.htmlBlobId),
      ]);
      return {
        messageId: email.id,
        textBody,
        htmlBody,
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
        await dependencies.core.getBlob({
          accountId: scope.mailAccountId,
          blobId: scope.blobId,
        });
        const bytes = await dependencies.core.readBlob({
          accountId: scope.mailAccountId,
          blobId: scope.blobId,
        });
        return {
          bytes,
          filename: scope.filename,
          contentType: scope.contentType,
          size: scope.sizeBytes.toString(),
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
