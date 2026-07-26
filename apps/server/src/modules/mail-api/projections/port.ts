import type { EmailLifecycle } from '@zero/mail-core';

export type ThreadPageProjectionInput = {
  accountId: string;
  mailboxId?: string;
  text?: string;
  hasKeyword?: string;
  lifecycle?: EmailLifecycle;
  snoozed?: boolean;
  cursor?: string;
  limit: number;
};

export type ThreadSummaryProjection = {
  id: string;
  emailIds: string[];
  emailCount: number;
  unreadCount: number;
  hasAttachment: boolean;
  subject: string;
  preview: string;
  participants: string | null;
  latestReceivedAt: string;
  mailboxIds: Record<string, true>;
  keywords: Record<string, true>;
  latestEmail: {
    id: string;
    lifecycle: EmailLifecycle;
    receivedAt: string;
  };
};

export type ThreadPageProjectionResult = {
  items: ThreadSummaryProjection[];
  cursor: string | null;
};

export interface MailViewProjection {
  threadPage(input: ThreadPageProjectionInput): Promise<ThreadPageProjectionResult>;
  threadDetail(input: {
    accountId: string;
    threadId: string;
  }): Promise<{ threadId: string; emailIds: string[] } | null>;
}
