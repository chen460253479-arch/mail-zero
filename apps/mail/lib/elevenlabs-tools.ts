import {
  adaptMailbox,
  buildDraftCreateInput,
  buildKeywordThreadAction,
  buildMoveThreadAction,
  buildSubmissionCreateInput,
  htmlToPlainText,
  resolveMailboxRoute,
  selectDeliveryIdentity,
  toMailAddresses,
} from '@/modules/mail';
import { trpcClient } from '@/providers/query-provider';

const getCurrentThreadId = () =>
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('threadId');

const mutationId = () =>
  globalThis.crypto?.randomUUID?.() ?? `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;

async function getMailContext() {
  const [connection, accounts] = await Promise.all([
    trpcClient.connections.getDefault.query(),
    trpcClient.mail.account.list.query(),
  ]);
  const account = accounts.accounts.find((candidate) => candidate.connectionId === connection?.id);
  if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
  const [mailboxResult, identityResult] = await Promise.all([
    trpcClient.mail.mailbox.get.query({ accountId: account.id }),
    trpcClient.mail.identity.get.query({ accountId: account.id }),
  ]);
  return {
    account,
    connection,
    mailboxes: mailboxResult.list.map(adaptMailbox),
    mailboxState: mailboxResult.state,
    identities: identityResult.list,
  };
}

async function getThreadDetail(threadId: string) {
  const { account } = await getMailContext();
  const detail = await trpcClient.mail.view.threadDetail.query({
    accountId: account.id,
    threadId,
    fetchTextBodyValues: true,
    fetchHTMLBodyValues: true,
    maxBodyValueBytes: 256_000,
  });
  const messages = detail.emails.map((email) => ({
    id: email.id,
    subject: email.subject,
    sender: email.sender[0] ?? email.from[0] ?? { name: null, email: '' },
    receivedOn: email.receivedAt,
    body: [...email.htmlBody, ...email.textBody]
      .map((part) => email.bodyValues[part.id]?.value ?? '')
      .join(''),
  }));
  return {
    id: detail.thread.id,
    messages,
    latest: messages.at(-1),
    hasUnread: detail.emails.some((email) => email.keywords.$seen !== true),
  };
}

const getRequestedThreadId = (params: Record<string, unknown>) => {
  for (const key of ['threadId', 'thread_id', 'id']) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return getCurrentThreadId();
};

async function listThreads(folder: string, query: string, limit: number) {
  const { account, mailboxes } = await getMailContext();
  const route = resolveMailboxRoute(folder.toLowerCase(), mailboxes);
  if (route.kind === 'not-found') throw new Error('MAILBOX_ROUTE_NOT_FOUND');
  return trpcClient.mail.view.threadPage.query({
    accountId: account.id,
    ...(route.kind === 'mailbox' ? { mailboxId: route.mailboxId } : { snoozed: true }),
    ...(query.trim() ? { text: query.trim() } : {}),
    limit: Math.min(Math.max(limit, 1), 200),
  });
}

async function updateKeyword(threadIds: string[], keyword: string, enabled: boolean) {
  const { account, mailboxState } = await getMailContext();
  return trpcClient.mail.action.updateThreads.mutate(
    buildKeywordThreadAction({
      accountId: account.id,
      threadIds,
      keyword,
      enabled,
      ifInState: mailboxState,
      clientMutationId: mutationId(),
    }),
  );
}

async function moveThreads(threadIds: string[], destination: 'archive' | 'bin') {
  const { account, mailboxes, mailboxState } = await getMailContext();
  return trpcClient.mail.action.updateThreads.mutate(
    buildMoveThreadAction({
      accountId: account.id,
      threadIds,
      destination,
      mailboxes,
      ifInState: mailboxState,
      clientMutationId: mutationId(),
    }),
  );
}

const success = <Value extends object>(value: Value) => ({ success: true, ...value });
const failure = (error: unknown) => ({
  success: false,
  error: error instanceof Error ? error.message : String(error),
});

export const toolExecutors = {
  listEmails: async (params: { folder: string; query: string; maxResults: number }) => {
    try {
      const result = await listThreads(
        params.folder || 'inbox',
        params.query ?? '',
        params.maxResults || 10,
      );
      return success({
        threads: result.items.map((thread) => ({
          id: thread.id,
          subject: thread.subject,
          from: thread.participants,
          date: thread.latestReceivedAt,
          preview: thread.preview,
          hasUnread: thread.unreadCount > 0,
        })),
      });
    } catch (error) {
      return failure(error);
    }
  },

  getEmail: async (params: Record<string, unknown>) => {
    const threadId = getRequestedThreadId(params);
    if (!threadId) return failure('No email is currently open');
    try {
      return success({ thread: await getThreadDetail(threadId), currentThreadId: threadId });
    } catch (error) {
      return failure(error);
    }
  },

  sendEmail: async (params: {
    to: string[];
    subject: string;
    message: string;
    threadId?: string;
  }) => {
    try {
      const { account, connection, identities } = await getMailContext();
      const identity = selectDeliveryIdentity(identities, connection?.email);
      if (!identity) throw new Error('MAIL_IDENTITY_UNAVAILABLE');
      const draftClientId = mutationId();
      const draftResult = await trpcClient.mail.email.set.mutate(
        buildDraftCreateInput({
          accountId: account.id,
          clientId: draftClientId,
          content: {
            identityId: identity.id,
            replyToEmailId: params.threadId
              ? ((await getThreadDetail(params.threadId)).latest?.id ?? null)
              : null,
            to: toMailAddresses(params.to),
            cc: [],
            bcc: [],
            subject: params.subject,
            textBody: htmlToPlainText(params.message),
            htmlBody: params.message,
            attachmentBlobIds: [],
          },
        }),
      );
      const draft = draftResult.created[draftClientId];
      if (!draft)
        throw new Error(draftResult.notCreated[draftClientId]?.code ?? 'DRAFT_CREATE_FAILED');
      const submissionClientId = mutationId();
      const submissionResult = await trpcClient.mail.submission.set.mutate(
        buildSubmissionCreateInput({
          accountId: account.id,
          clientId: submissionClientId,
          emailId: draft.id,
          identityId: identity.id,
          idempotencyKey: mutationId(),
          undoWindowMs: 0,
        }),
      );
      if (!submissionResult.created[submissionClientId]) {
        throw new Error(
          submissionResult.notCreated[submissionClientId]?.code ?? 'SUBMISSION_CREATE_FAILED',
        );
      }
      return success({ message: 'Email queued successfully' });
    } catch (error) {
      return failure(error);
    }
  },

  markAsRead: async (params: { threadIds: string[] }) => {
    try {
      await updateKeyword(params.threadIds, '$seen', true);
      return success({ message: 'Emails marked as read' });
    } catch (error) {
      return failure(error);
    }
  },

  markAsUnread: async (params: { threadIds: string[] }) => {
    try {
      await updateKeyword(params.threadIds, '$seen', false);
      return success({ message: 'Emails marked as unread' });
    } catch (error) {
      return failure(error);
    }
  },

  archiveEmails: async (params: { threadIds: string[] }) => {
    try {
      await moveThreads(params.threadIds, 'archive');
      return success({ message: 'Emails archived' });
    } catch (error) {
      return failure(error);
    }
  },

  deleteEmails: async (params: { threadIds: string[] }) => {
    try {
      await moveThreads(params.threadIds, 'bin');
      return success({ message: 'Emails moved to trash' });
    } catch (error) {
      return failure(error);
    }
  },

  deleteEmail: async () => {
    const threadId = getCurrentThreadId();
    if (!threadId) return failure('No email is currently open');
    try {
      await moveThreads([threadId], 'bin');
      return success({ message: 'Email moved to trash' });
    } catch (error) {
      return failure(error);
    }
  },

  createLabel: async (params: { name: string; backgroundColor: string }) => {
    try {
      const { account, mailboxState } = await getMailContext();
      const clientId = mutationId();
      const created = await trpcClient.mail.mailbox.set.mutate({
        accountId: account.id,
        ifInState: mailboxState,
        create: {
          [clientId]: { name: params.name, kind: 'label', role: null, parentId: null },
        },
        update: {},
        destroy: [],
      });
      const mailbox = created.created[clientId];
      if (!mailbox) throw new Error(created.notCreated[clientId]?.code ?? 'MAILBOX_CREATE_FAILED');
      if (params.backgroundColor) {
        await trpcClient.mail.mailbox.set.mutate({
          accountId: account.id,
          ifInState: created.newState,
          create: {},
          update: { [mailbox.id]: { color: params.backgroundColor } },
          destroy: [],
        });
      }
      return success({ message: 'Label created' });
    } catch (error) {
      return failure(error);
    }
  },

  applyLabel: async (params: { label: string; threadIds: string[] }) => {
    try {
      const { account, mailboxes, mailboxState } = await getMailContext();
      const mailbox = mailboxes.find((candidate) => candidate.name === params.label);
      if (!mailbox) throw new Error('Label not found');
      await trpcClient.mail.action.updateThreads.mutate({
        accountId: account.id,
        threadIds: params.threadIds,
        ifInState: mailboxState,
        addMailboxIds: [mailbox.id],
        removeMailboxIds: [],
        addKeywords: [],
        removeKeywords: [],
        clientMutationId: mutationId(),
      });
      return success({ message: 'Label applied' });
    } catch (error) {
      return failure(error);
    }
  },

  removeLabel: async (params: { label: string; threadIds?: string[] }) => {
    const threadIds = params.threadIds?.length
      ? params.threadIds
      : ([getCurrentThreadId()].filter(Boolean) as string[]);
    if (threadIds.length === 0) return failure('No email is currently open');
    try {
      const { account, mailboxes, mailboxState } = await getMailContext();
      const mailbox = mailboxes.find((candidate) => candidate.name === params.label);
      if (!mailbox) throw new Error('Label not found');
      await trpcClient.mail.action.updateThreads.mutate({
        accountId: account.id,
        threadIds,
        ifInState: mailboxState,
        addMailboxIds: [],
        removeMailboxIds: [mailbox.id],
        addKeywords: [],
        removeKeywords: [],
        clientMutationId: mutationId(),
      });
      return success({ message: 'Label removed' });
    } catch (error) {
      return failure(error);
    }
  },

  searchEmails: async (params: { question: string; maxResults: number }) => {
    try {
      const result = await listThreads('inbox', params.question, params.maxResults || 5);
      return success({ results: result.items });
    } catch (error) {
      return failure(error);
    }
  },

  webSearch: async (params: { query: string }) => {
    const threadId = getCurrentThreadId();
    if (!threadId) return failure('No email is currently open');
    try {
      const thread = await getThreadDetail(threadId);
      const content = thread.messages.map((message) => message.body).join('\n\n');
      const { text } = await trpcClient.ai.webSearch.mutate({
        query: `Email subject: ${thread.latest?.subject ?? 'No subject'}\n\n${content}\n\nQuestion: ${params.query}`,
      });
      return success({ result: text });
    } catch (error) {
      return failure(error);
    }
  },

  summarizeEmail: async () => {
    const threadId = getCurrentThreadId();
    if (!threadId) return failure('No email is currently open');
    try {
      const thread = await getThreadDetail(threadId);
      const content = thread.messages.map((message) => message.body).join('\n\n');
      const { text } = await trpcClient.ai.webSearch.mutate({
        query: `Summarize this email thread in 2-3 sentences, including actions and urgency:\n\n${content}`,
      });
      return success({
        result: {
          threadId,
          subject: thread.latest?.subject ?? 'No subject',
          from: thread.latest?.sender.email ?? '',
          messageCount: thread.messages.length,
          hasUnread: thread.hasUnread,
          summary: text,
        },
      });
    } catch (error) {
      return failure(error);
    }
  },
};
