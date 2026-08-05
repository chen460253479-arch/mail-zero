import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

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
    const deliverySource = readSource('modules/mail-notifications/application/deliver-pending.ts');
    const payloadBody = /body:\s*JSON\.stringify\(\{(?<body>[\s\S]*?)\}\),/u.exec(deliverySource)
      ?.groups?.body;
    const notificationContractShape = [
      ...(payloadBody?.matchAll(/^\s*(?<key>[A-Za-z]\w*):/gmu) ?? []),
    ].map((match) => match.groups!.key);

    expect(notificationContractShape).toEqual(['eventId', 'messageId']);
  });

  it('defines the CRM customer marker as one explicit namespaced business keyword', () => {
    const markerContract = readSource('modules/external-integration/contracts/customer-marker.ts');
    expect(markerContract).toContain("CRM_CUSTOMER_KEYWORD = 'crm/customer'");
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
