import { ZodError } from 'zod';

import {
  parseImapBaselineRequest,
  parseImapDiscoverRequest,
  parseImapRawRequest,
  parseProtocolVerifyRequest,
  parseProtocolVerifyResponse,
  parseSmtpSendRequest,
  type ImapBaselineRequest,
  type ImapBaselineResponse,
  type ImapDiscoverRequest,
  type ImapDiscoverResponse,
  type ImapRawRequest,
  type ImapRawResponse,
  type ProtocolVerifyRequest,
  type ProtocolVerifyResponse,
  type SmtpSendRequest,
  type SmtpSendResponse,
} from '../../../protocol-worker/contracts';
import {
  discoverImapMessages,
  establishImapBaseline,
  fetchImapRawMessage,
} from '../../../protocol-worker/imap/client';
import {
  classifyMailProtocolError,
  MailProtocolOperationError,
} from '../../../protocol-worker/errors';
import { sendSmtpMessage, verifySmtpConnection } from '../../../protocol-worker/smtp/client';

export interface ImapSmtpProtocolExecutor {
  verify(input: ProtocolVerifyRequest): Promise<ProtocolVerifyResponse>;
  establishBaseline(input: ImapBaselineRequest): Promise<ImapBaselineResponse>;
  discover(input: ImapDiscoverRequest): Promise<ImapDiscoverResponse>;
  fetchRaw(input: ImapRawRequest): Promise<ImapRawResponse>;
  send(input: SmtpSendRequest): Promise<SmtpSendResponse>;
}

type ProtocolOperation = 'imap' | 'verify' | 'smtp_send';

const execute = async <T>(operation: ProtocolOperation, run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ZodError) {
      throw new MailProtocolOperationError('MAIL_PROTOCOL_INVALID_REQUEST', 'permanent', {
        cause: error,
      });
    }
    throw classifyMailProtocolError(error, operation);
  }
};

export const createImapSmtpProtocolExecutor = (input: {
  allowedHosts?: string;
}): ImapSmtpProtocolExecutor => ({
  verify: async (value) =>
    await execute('verify', async () => {
      const request = parseProtocolVerifyRequest(value);
      await establishImapBaseline(
        { credential: request.credential, mailbox: 'INBOX' },
        input.allowedHosts,
      );
      await verifySmtpConnection(request.credential, input.allowedHosts);
      return parseProtocolVerifyResponse({ email: request.credential.email });
    }),

  establishBaseline: async (value) =>
    await execute('imap', async () => {
      const request = parseImapBaselineRequest(value);
      return await establishImapBaseline(request, input.allowedHosts);
    }),

  discover: async (value) =>
    await execute('imap', async () => {
      const request = parseImapDiscoverRequest(value);
      return await discoverImapMessages(request, input.allowedHosts);
    }),

  fetchRaw: async (value) =>
    await execute('imap', async () => {
      const request = parseImapRawRequest(value);
      return await fetchImapRawMessage(request, input.allowedHosts);
    }),

  send: async (value) =>
    await execute('smtp_send', async () => {
      const request = parseSmtpSendRequest(value);
      return await sendSmtpMessage(request, input.allowedHosts);
    }),
});
