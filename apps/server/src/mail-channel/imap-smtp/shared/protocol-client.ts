import type {
  ImapBaselineResponse,
  ImapDiscoverResponse,
  ImapPageCursor,
  ImapRawResponse,
  ProtocolVerifyResponse,
  SmtpSendResponse,
} from './contracts';
import { MailProtocolOperationError } from './errors';
import type { ImapSmtpProtocolExecutor } from '../runtime/protocol-executor';
import type { ImapSmtpCredential } from '../../contracts';

export type ProtocolFailureClassification =
  | 'authentication'
  | 'retryable'
  | 'permanent'
  | 'uncertain';

export class MailProtocolClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly classification: ProtocolFailureClassification,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'MailProtocolClientError';
  }
}

export type MailProtocolClient = {
  verify(): Promise<ProtocolVerifyResponse>;
  establishImapBaseline(): Promise<ImapBaselineResponse>;
  discoverImap(input: {
    expectedUidValidity: string;
    nextUid: number;
    lastSuccessfulAt: string;
    cursor: ImapPageCursor | null;
    limit: number;
  }): Promise<ImapDiscoverResponse>;
  fetchImapRaw(input: { uidValidity: string; uid: number }): Promise<ImapRawResponse>;
  sendSmtp(input: {
    envelope: { from: string; to: string[] };
    rawMimeBase64: string;
    messageId: string;
  }): Promise<SmtpSendResponse>;
};

const invoke = async <T>(
  run: () => Promise<T>,
  fallbackClassification: ProtocolFailureClassification,
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MailProtocolClientError) throw error;
    if (error instanceof MailProtocolOperationError) {
      throw new MailProtocolClientError(error.code, error.classification, {
        cause: error,
      });
    }
    throw new MailProtocolClientError('MAIL_PROTOCOL_OPERATION_FAILED', fallbackClassification, {
      cause: error,
    });
  }
};

export const createMailProtocolClient = (input: {
  executor: ImapSmtpProtocolExecutor;
  credential: ImapSmtpCredential;
}): MailProtocolClient => ({
  verify: async () =>
    await invoke(() => input.executor.verify({ credential: input.credential }), 'retryable'),

  establishImapBaseline: async () =>
    await invoke(
      () =>
        input.executor.establishBaseline({
          credential: input.credential,
          mailbox: 'INBOX',
        }),
      'retryable',
    ),

  discoverImap: async (discoverInput) =>
    await invoke(
      () =>
        input.executor.discover({
          credential: input.credential,
          mailbox: 'INBOX',
          ...discoverInput,
        }),
      'retryable',
    ),

  fetchImapRaw: async (rawInput) =>
    await invoke(
      () =>
        input.executor.fetchRaw({
          credential: input.credential,
          mailbox: 'INBOX',
          ...rawInput,
        }),
      'retryable',
    ),

  sendSmtp: async (sendInput) =>
    await invoke(
      () =>
        input.executor.send({
          credential: input.credential,
          ...sendInput,
        }),
      'uncertain',
    ),
});
