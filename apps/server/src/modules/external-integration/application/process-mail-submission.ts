import {
  MailCoreError,
  type BlobId,
  type EmailId,
  type IdentityId,
  type MailAccountId,
  type MailCore,
} from '@zero/mail-core';

import {
  EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES,
  type ExternalMailAttachment,
} from '../contracts/mail-submission';
import type { ExternalMailSubmissionRepository } from './mail-submission';
import type { MailOutboundRuntime } from '../../mail-outbound';
import { MailTaskProcessingError } from '../../mail-tasks';

const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 30_000;

export type ProcessExternalMailSubmissionDependencies = {
  repository: ExternalMailSubmissionRepository;
  core: Pick<MailCore, 'createDraft' | 'uploadBlob'>;
  outbound: Pick<MailOutboundRuntime, 'submit'>;
  fetch: typeof fetch;
  clock: { now(): Date };
};

type DownloadedAttachment = {
  bytes: Uint8Array;
  contentType: string;
};

const processingError = (
  code: string,
  disposition: 'permanent' | 'retryable',
  message: string = code,
): MailTaskProcessingError => new MailTaskProcessingError(code, disposition, message);

const declaredContentLength = (response: Response): number | null => {
  const value = response.headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/u.test(value)) {
    throw processingError('ATTACHMENT_CONTENT_LENGTH_INVALID', 'permanent');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw processingError('ATTACHMENT_CONTENT_LENGTH_INVALID', 'permanent');
  }
  return parsed;
};

const downloadAttachment = async (
  attachment: ExternalMailAttachment,
  maximumBytes: number,
  fetchImplementation: typeof fetch,
): Promise<DownloadedAttachment> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
  try {
    let requestUrl = attachment.url;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetchImplementation(requestUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) break;
      if (redirects === 5) {
        throw processingError('ATTACHMENT_TOO_MANY_REDIRECTS', 'permanent');
      }
      const location = response.headers.get('location');
      if (location === null) {
        throw processingError('ATTACHMENT_REDIRECT_INVALID', 'permanent');
      }
      const redirectUrl = new URL(location, requestUrl);
      if (redirectUrl.protocol !== 'https:') {
        throw processingError('ATTACHMENT_REDIRECT_INSECURE', 'permanent');
      }
      requestUrl = redirectUrl.toString();
    }
    if (response === null) {
      throw processingError('ATTACHMENT_DOWNLOAD_FAILED', 'retryable');
    }
    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      throw processingError(
        'ATTACHMENT_DOWNLOAD_HTTP_ERROR',
        retryable ? 'retryable' : 'permanent',
        `Attachment download returned HTTP ${response.status}`,
      );
    }

    const length = declaredContentLength(response);
    if (length !== null && length > maximumBytes) {
      throw processingError('ATTACHMENT_TOTAL_TOO_LARGE', 'permanent');
    }
    if (response.body === null) {
      return {
        bytes: new Uint8Array(),
        contentType:
          attachment.contentType ??
          response.headers.get('content-type') ??
          'application/octet-stream',
      };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw processingError('ATTACHMENT_TOTAL_TOO_LARGE', 'permanent');
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      bytes,
      contentType:
        attachment.contentType ??
        response.headers.get('content-type') ??
        'application/octet-stream',
    };
  } catch (error) {
    if (error instanceof MailTaskProcessingError) throw error;
    throw processingError('ATTACHMENT_DOWNLOAD_FAILED', 'retryable');
  } finally {
    clearTimeout(timeout);
  }
};

const mapMailCoreError = (error: MailCoreError): MailTaskProcessingError =>
  processingError(
    error.code,
    error.code === 'BLOB_STORE_FAILURE' || error.code === 'STORAGE_FAILURE'
      ? 'retryable'
      : 'permanent',
  );

export const processExternalMailSubmission = async (
  submissionId: string,
  dependencies: ProcessExternalMailSubmissionDependencies,
): Promise<void> => {
  try {
    const submission = await dependencies.repository.beginPreparation(
      submissionId,
      dependencies.clock.now(),
    );
    if (submission === null) return;

    let emailId = submission.emailId;
    if (emailId === null) {
      const attachments: Array<{ blobId: BlobId; filename: string }> = [];
      let downloadedBytes = 0;
      for (const attachment of submission.payload.attachments) {
        const downloaded = await downloadAttachment(
          attachment,
          EXTERNAL_MAIL_ATTACHMENT_TOTAL_MAX_BYTES - downloadedBytes,
          dependencies.fetch,
        );
        downloadedBytes += downloaded.bytes.byteLength;
        const uploaded = await dependencies.core.uploadBlob({
          accountId: submission.mailAccountId as MailAccountId,
          bytes: downloaded.bytes,
          contentType: downloaded.contentType,
        });
        attachments.push({
          blobId: uploaded.blob.id,
          filename: attachment.filename,
        });
      }

      const draft = await dependencies.core.createDraft({
        accountId: submission.mailAccountId as MailAccountId,
        identityId: submission.identityId as IdentityId,
        replyToEmailId: (submission.payload.replyToMessageId ?? null) as EmailId | null,
        to: submission.payload.to,
        cc: submission.payload.cc,
        bcc: submission.payload.bcc,
        subject: submission.payload.subject,
        textBody: submission.payload.textBody,
        htmlBody: submission.payload.htmlBody,
        attachments,
      });
      emailId = draft.id;
      await dependencies.repository.markDraftCreated(
        submission.id,
        emailId,
        dependencies.clock.now(),
      );
    }

    const result = await dependencies.outbound.submit({
      accountId: submission.mailAccountId as MailAccountId,
      emailId: emailId as EmailId,
      identityId: submission.identityId as IdentityId,
      idempotencyKey: `external-mail:${submission.id}`,
      sendAt: submission.payload.sendAt == null ? null : new Date(submission.payload.sendAt),
    });
    await dependencies.repository.markSubmitted(
      submission.id,
      emailId,
      result.submission.id,
      dependencies.clock.now(),
    );
  } catch (error) {
    if (error instanceof MailCoreError) throw mapMailCoreError(error);
    throw error;
  }
};
