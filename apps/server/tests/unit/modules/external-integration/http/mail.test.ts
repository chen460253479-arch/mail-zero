import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import { ExternalIntegrationError } from '../../../../../src/modules/external-integration/errors';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const summary = {
  messageId: 'local-email-1',
  internetMessageId: '<rfc@example.test>',
  threadId: 'thread-1',
  mailAccountId: 'account-1',
  nangoConnectionId: 'connect-gmail-1',
  channelId: 'gmail' as const,
  lifecycle: 'received' as const,
  mailboxIds: ['inbox-1'],
  keywords: [],
  subject: 'Trip',
  preview: 'Trip preview',
  sender: [],
  from: [],
  to: [],
  cc: [],
  bcc: [],
  sentAt: null,
  receivedAt: '2026-07-29T09:00:00.000Z',
  hasAttachment: true,
  attachmentCount: 1,
};

const createRouter = () =>
  createExternalIntegrationRouter(
    {
      config: {
        externalIntegration: {
          apiToken: 'fixed-token',
          webhook: {
            enabled: false,
          },
        },
      },
      database: {
        db: {},
      },
    } as RuntimeServices,
    {
      ensurePrincipal: vi.fn(async () => ({
        userId: 'zero-external-integration' as const,
      })),
      connect: vi.fn(),
      createMessageReader: vi.fn(() => ({
        getSummary: async (messageId: string) => {
          if (messageId !== summary.messageId) {
            throw new ExternalIntegrationError('MESSAGE_NOT_FOUND');
          }
          return summary;
        },
        getContent: async () => ({
          messageId: summary.messageId,
          textBody: 'Plain body',
          htmlBody: '<p>HTML body</p>',
        }),
        listAttachments: async () => [
          {
            attachmentId: 'part-1',
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            disposition: 'attachment' as const,
            size: '4',
          },
        ],
        getAttachmentContent: async (attachmentId: string) => {
          if (attachmentId !== 'part-1') {
            throw new ExternalIntegrationError('ATTACHMENT_NOT_FOUND');
          }
          return {
            bytes: new Uint8Array([1, 2, 3, 4]),
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            size: '4',
          };
        },
      })),
    },
  );

const authorizedGet = async (
  app: ReturnType<typeof createExternalIntegrationRouter>,
  path: string,
  token: string | null = 'fixed-token',
) =>
  await app.request(path, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

describe('external mail read HTTP contract', () => {
  it('returns a scoped message summary', async () => {
    const response = await authorizedGet(createRouter(), '/mail/messages/local-email-1/summary');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(summary);
  });

  it('returns content and attachment metadata only from their dedicated endpoints', async () => {
    const app = createRouter();
    const content = await authorizedGet(app, '/mail/messages/local-email-1/content');
    const attachments = await authorizedGet(app, '/mail/messages/local-email-1/attachments');

    await expect(content.json()).resolves.toEqual({
      messageId: 'local-email-1',
      textBody: 'Plain body',
      htmlBody: '<p>HTML body</p>',
    });
    await expect(attachments.json()).resolves.toEqual([
      {
        attachmentId: 'part-1',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        disposition: 'attachment',
        size: '4',
      },
    ]);
  });

  it('hides normal user messages as not found', async () => {
    const response = await authorizedGet(
      createRouter(),
      '/mail/messages/normal-user-email/summary',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'MESSAGE_NOT_FOUND',
    });
  });

  it('requires the fixed token for attachment content', async () => {
    const response = await authorizedGet(createRouter(), '/mail/attachments/part-1/content', null);

    expect(response.status).toBe(401);
  });

  it('streams attachment bytes without exposing a blob id', async () => {
    const response = await authorizedGet(createRouter(), '/mail/attachments/part-1/content');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('invoice.pdf');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});
