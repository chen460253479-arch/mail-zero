import type { CustomerMarker, Email, EmailKeywordMap, EmailLifecycle } from './email';

export type ThreadSummary = {
  id: string;
  emailIds: string[];
  emailCount: number;
  unreadCount: number;
  hasAttachment: boolean;
  subject: string;
  preview: string;
  participants: string | null;
  latestReceivedAt: string;
  mailboxIds: string[];
  keywords: EmailKeywordMap;
  customerMarkers: CustomerMarker[];
  latestEmail: {
    id: string;
    lifecycle: EmailLifecycle;
    receivedAt: string;
    to: Array<{ name?: string | null; email: string }>;
  };
};

export type ThreadDetail = {
  id: string;
  emailIds: string[];
  emails: Email[];
};
