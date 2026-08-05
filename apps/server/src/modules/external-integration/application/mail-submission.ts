import { createHash } from 'node:crypto';

import type {
  ExternalMailSubmissionInput,
  ExternalMailSubmissionPayload,
  ExternalMailSubmissionPublicStatus,
  ExternalMailSubmissionResponse,
} from '../contracts/mail-submission';
import type { ExternalMailSubmissionStoredStatus } from '../postgres/schema';
import { ExternalIntegrationError } from '../errors';

export type ExternalMailSubmissionScope = {
  userId: string;
  mailAccountId: string;
  internalConnectionId: string;
  identityId: string;
};

export type ExternalMailSubmissionRecord = {
  id: string;
  userId: string;
  mailAccountId: string;
  internalConnectionId: string;
  identityId: string;
  externalUserId: string;
  externalConnectionId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  payload: ExternalMailSubmissionPayload;
  status: ExternalMailSubmissionStoredStatus;
  emailId: string | null;
  submissionId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExternalMailSubmissionView = ExternalMailSubmissionRecord & {
  publicStatus: ExternalMailSubmissionPublicStatus;
  sentAt: Date | null;
};

export type CreateExternalMailSubmissionRecord = {
  record: ExternalMailSubmissionRecord;
  taskId: string;
};

export interface ExternalMailSubmissionRepository {
  findById(id: string): Promise<ExternalMailSubmissionView | null>;
  findByIdempotency(
    externalUserId: string,
    externalConnectionId: string,
    idempotencyKey: string,
  ): Promise<ExternalMailSubmissionView | null>;
  resolveScope(
    externalUserId: string,
    externalConnectionId: string,
  ): Promise<ExternalMailSubmissionScope | null | 'ambiguous' | 'user_not_found'>;
  create(
    input: CreateExternalMailSubmissionRecord,
  ): Promise<
    | { outcome: 'created'; submission: ExternalMailSubmissionView }
    | { outcome: 'existing'; submission: ExternalMailSubmissionView }
    | { outcome: 'conflict'; submission: ExternalMailSubmissionView }
  >;
  beginPreparation(id: string, now: Date): Promise<ExternalMailSubmissionRecord | null>;
  markDraftCreated(id: string, emailId: string, now: Date): Promise<void>;
  markSubmitted(id: string, emailId: string, submissionId: string, now: Date): Promise<void>;
  recordProcessingFailure(input: {
    id: string;
    code: string;
    message: string;
    final: boolean;
    now: Date;
  }): Promise<void>;
}

export type SubmitExternalMailDependencies = {
  repository: ExternalMailSubmissionRepository;
  nextId(): string;
  nextTaskId(): string;
  clock: { now(): Date };
  notifyWorker(): void;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

export const fingerprintExternalMailSubmission = (input: ExternalMailSubmissionInput): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');

export const toExternalMailSubmissionResponse = (
  submission: ExternalMailSubmissionView,
): ExternalMailSubmissionResponse => ({
  id: submission.id,
  externalUserId: submission.externalUserId,
  connectionId: submission.externalConnectionId,
  status: submission.publicStatus,
  messageId: submission.emailId,
  createdAt: submission.createdAt.toISOString(),
  updatedAt: submission.updatedAt.toISOString(),
  sentAt: submission.sentAt?.toISOString() ?? null,
  error:
    submission.lastErrorCode === null
      ? null
      : {
          code: submission.lastErrorCode,
          message: submission.lastErrorMessage,
        },
});

const payloadFromInput = (input: ExternalMailSubmissionInput): ExternalMailSubmissionPayload => ({
  replyToMessageId: input.replyToMessageId ?? null,
  to: input.to,
  cc: input.cc,
  bcc: input.bcc,
  subject: input.subject,
  textBody: input.textBody,
  htmlBody: input.htmlBody,
  attachments: input.attachments,
  sendAt: input.sendAt ?? null,
});

export const submitExternalMail = async (
  input: ExternalMailSubmissionInput & { idempotencyKey: string },
  dependencies: SubmitExternalMailDependencies,
): Promise<{ response: ExternalMailSubmissionResponse; created: boolean }> => {
  const { idempotencyKey, ...requestInput } = input;
  const requestFingerprint = fingerprintExternalMailSubmission(requestInput);
  const existing = await dependencies.repository.findByIdempotency(
    input.externalUserId,
    input.connectionId,
    idempotencyKey,
  );
  if (existing !== null) {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ExternalIntegrationError('IDEMPOTENCY_CONFLICT');
    }
    return { response: toExternalMailSubmissionResponse(existing), created: false };
  }

  const scope = await dependencies.repository.resolveScope(
    input.externalUserId,
    input.connectionId,
  );
  if (scope === 'ambiguous') {
    throw new ExternalIntegrationError('NANGO_CONNECTION_AMBIGUOUS');
  }
  if (scope === 'user_not_found') {
    throw new ExternalIntegrationError('EXTERNAL_USER_NOT_FOUND');
  }
  if (scope === null) {
    throw new ExternalIntegrationError('NANGO_CONNECTION_NOT_BOUND');
  }

  const now = dependencies.clock.now();
  const id = dependencies.nextId();
  const result = await dependencies.repository.create({
    taskId: dependencies.nextTaskId(),
    record: {
      id,
      ...scope,
      externalUserId: input.externalUserId,
      externalConnectionId: input.connectionId,
      idempotencyKey,
      requestFingerprint,
      payload: payloadFromInput(input),
      status: 'accepted',
      emailId: null,
      submissionId: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  if (result.outcome === 'conflict') {
    throw new ExternalIntegrationError('IDEMPOTENCY_CONFLICT');
  }
  if (result.outcome === 'created') dependencies.notifyWorker();
  return {
    response: toExternalMailSubmissionResponse(result.submission),
    created: result.outcome === 'created',
  };
};

export const getExternalMailSubmission = async (
  id: string,
  repository: Pick<ExternalMailSubmissionRepository, 'findById'>,
): Promise<ExternalMailSubmissionResponse> => {
  const submission = await repository.findById(id);
  if (submission === null) {
    throw new ExternalIntegrationError('EXTERNAL_MAIL_SUBMISSION_NOT_FOUND');
  }
  return toExternalMailSubmissionResponse(submission);
};
