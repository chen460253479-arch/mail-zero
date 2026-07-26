import type { gmail_v1 } from '@googleapis/gmail';

import type { GmailApiTransport } from './api-client';

export interface GmailApiExecutor {
  runGmailApi<Result>(operation: (client: gmail_v1.Gmail) => Promise<Result>): Promise<Result>;
}

export const createGmailTransportFromExecutor = (
  executor: GmailApiExecutor,
): GmailApiTransport => ({
  getProfile: (request) => executor.runGmailApi((client) => client.users.getProfile(request)),
  listHistory: ({ pageToken, ...request }) =>
    executor.runGmailApi((client) =>
      client.users.history.list({
        ...request,
        ...(pageToken === null ? {} : { pageToken }),
      }),
    ),
  getMessage: (request) => executor.runGmailApi((client) => client.users.messages.get(request)),
  watch: (request) => executor.runGmailApi((client) => client.users.watch(request)),
});
