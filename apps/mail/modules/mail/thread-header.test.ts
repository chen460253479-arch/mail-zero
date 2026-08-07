import { describe, expect, it } from 'vitest';

import type { ParsedMessage } from '@/types';
import { buildThreadHeader } from './thread-header';

const message = (overrides: Partial<ParsedMessage>): ParsedMessage => ({
  id: 'message',
  title: '',
  subject: '',
  tags: [],
  sender: { name: 'Sender', email: 'sender@example.com' },
  to: [],
  cc: null,
  bcc: null,
  tls: true,
  receivedOn: '2026-08-06T16:22:00.000Z',
  unread: false,
  body: '',
  processedHtml: '',
  blobUrl: '',
  ...overrides,
});

describe('buildThreadHeader', () => {
  it('keeps the thread subject and customer marker when the newest reply has neither', () => {
    const customerLabel = {
      id: 'crm/customer:customer-123',
      name: 'Customer email · Acme',
      type: 'crm/customer' as const,
    };
    const root = message({
      id: 'root',
      subject: 'Route 1: Golden Triangle',
      tags: [customerLabel],
    });
    const newestReply = message({ id: 'reply', subject: '', tags: [] });

    expect(buildThreadHeader([root, newestReply])).toEqual({
      subject: 'Route 1: Golden Triangle',
      labels: [customerLabel],
    });
  });

  it('deduplicates labels collected across the whole thread', () => {
    const important = { id: '$important', name: 'IMPORTANT', type: 'keyword' as const };

    expect(
      buildThreadHeader([
        message({ id: 'first', subject: 'Subject', tags: [important] }),
        message({ id: 'second', tags: [important] }),
      ]).labels,
    ).toEqual([important]);
  });
});
