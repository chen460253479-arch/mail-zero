import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toMailNotificationWebhookPayload } from '../../src/modules/mail-notifications/application/deliver-pending';

const serverSourceRoot = resolve(import.meta.dirname, '../../src');

const readSource = (path: string): string => readFileSync(resolve(serverSourceRoot, path), 'utf8');

const readTree = (path: string): string =>
  readdirSync(resolve(serverSourceRoot, path), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)))
    .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), 'utf8'))
    .join('\n');

const integrationProductionSources = (): string =>
  [
    readTree('modules/external-integration'),
    readTree('modules/mail-notifications'),
    readSource('runtime/node/application.ts'),
    readSource('runtime/node/config.ts'),
    readSource('env.ts'),
  ].join('\n');

describe('external mail integration contract', () => {
  it('keeps the webhook payload shape exact', () => {
    expect(
      toMailNotificationWebhookPayload({
        eventId: 'event-1',
        eventType: 'message',
        messageId: 'message-1',
        accountId: 'account-1',
        kind: 'received',
        createCustomerIfMissing: false,
        attempts: 1,
        leaseOwner: 'worker-1',
      }),
    ).toEqual({
      eventId: 'event-1',
      messageId: 'message-1',
      createCustomerIfMissing: false,
    });
  });

  it('defines an explicit terminal submission status webhook contract', () => {
    expect(
      toMailNotificationWebhookPayload({
        eventId: 'event-2',
        eventType: 'submission_status',
        externalSubmissionId: 'external-submission-1',
        messageId: null,
        accountId: 'account-1',
        kind: 'failed',
        occurredAt: new Date('2026-08-24T10:00:00.000Z'),
        sentAt: null,
        errorCode: 'MAIL_SEND_FAILED',
        errorMessage: 'The provider rejected the message',
        attempts: 1,
        leaseOwner: 'worker-1',
      }),
    ).toEqual({
      eventId: 'event-2',
      eventType: 'mail.submission.failed',
      occurredAt: '2026-08-24T10:00:00.000Z',
      submissionId: 'external-submission-1',
      messageId: null,
      status: 'failed',
      sentAt: null,
      error: {
        code: 'MAIL_SEND_FAILED',
        message: 'The provider rejected the message',
      },
    });
  });

  it('defines the CRM customer marker as one explicit business keyword', () => {
    const markerContract = readSource('modules/external-integration/contracts/customer-marker.ts');
    expect(markerContract).toContain("CRM_CUSTOMER_KEYWORD = 'customer'");
  });

  it('defines no webhook signature contract', () => {
    expect(integrationProductionSources()).not.toMatch(
      /MAIL_WEBHOOK_SECRET|X-Zero-Webhook-Signature/iu,
    );
  });

  it('defines no initial or historical synchronization route or event', () => {
    expect(integrationProductionSources()).not.toMatch(
      /mailbox\.sync\.completed|initial-history|history-sync/iu,
    );
  });

  it('uses no synthetic integration-principal mailbox owner', () => {
    expect(integrationProductionSources()).not.toMatch(
      /zero-external-integration|ensureExternalIntegrationPrincipal/iu,
    );
  });
});
