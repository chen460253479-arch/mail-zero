import { describe, expect, it, vi } from 'vitest';
import type { MailCore } from '@zero/mail-core';

import { createThreadViewService } from '../../../../../src/modules/mail-api/application/thread-view-service';

describe('Thread view service', () => {
  it('returns one summary per projected thread without reading body blobs', async () => {
    const readBlob = vi.fn();
    const projection = {
      threadPage: vi.fn(async () => ({
        items: [
          {
            id: 'thread-1',
            emailIds: ['email-1'],
            emailCount: 1,
            unreadCount: 1,
            hasAttachment: false,
            subject: 'Subject',
            preview: 'Preview',
            participants: 'Sender',
            latestReceivedAt: '2026-01-01T00:00:00.000Z',
            mailboxIds: { inbox: true as const },
            keywords: {},
            customerMarkers: [],
            latestEmail: {
              id: 'email-1',
              lifecycle: 'received' as const,
              receivedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        ],
        cursor: null,
      })),
      threadDetail: vi.fn(),
    };
    const service = createThreadViewService(
      {
        getState: vi.fn(async () => '3'),
        readBlob,
      } as unknown as MailCore,
      projection,
    );

    const result = await service.threadPage({
      accountId: 'account-1',
      limit: 50,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.latestEmail.id).toBe('email-1');
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('passes the full filter signature to the projection', async () => {
    const projection = {
      threadPage: vi.fn(async () => ({ items: [], cursor: null })),
      threadDetail: vi.fn(),
    };
    const service = createThreadViewService(
      { getState: vi.fn(async () => '1') } as unknown as MailCore,
      projection,
    );
    await service.threadPage({
      accountId: 'account-1',
      mailboxId: 'inbox',
      hasKeyword: '$seen',
      hasKeywords: ['$important'],
      hasMailboxIds: ['project-mailbox'],
      unreadOnly: true,
      lifecycle: 'received',
      text: 'release',
      snoozed: false,
      cursor: 'cursor',
      limit: 20,
    });
    expect(projection.threadPage).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: 'inbox',
        hasKeyword: '$seen',
        hasKeywords: ['$important'],
        hasMailboxIds: ['project-mailbox'],
        unreadOnly: true,
        lifecycle: 'received',
        text: 'release',
      }),
    );
  });
});
