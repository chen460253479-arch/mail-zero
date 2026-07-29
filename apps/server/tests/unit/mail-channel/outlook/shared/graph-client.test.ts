import { describe, expect, it, vi } from 'vitest';

import {
  createOutlookInboxDeltaUrl,
  createMicrosoftGraphClient,
  type MicrosoftGraphTransport,
} from '../../../../../src/mail-channel/outlook/shared/graph-client';

const transport = (request: MicrosoftGraphTransport['request']): MicrosoftGraphTransport => ({
  request,
});

describe('Microsoft Graph client', () => {
  it('uses only the fixed Graph host and immutable Outlook message identifiers', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      json: {
        id: 'user-1',
        displayName: 'Owner',
        mail: 'owner@example.com',
        userPrincipalName: 'owner@example.com',
      },
      bytes: new Uint8Array(),
    }));
    const client = createMicrosoftGraphClient(transport(request));

    await expect(client.getIdentity()).resolves.toEqual({
      email: 'owner@example.com',
      name: 'Owner',
      picture: '',
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://graph.microsoft.com/v1.0/me',
        headers: expect.objectContaining({
          Prefer: 'IdType="ImmutableId"',
        }),
      }),
    );
  });

  it('rejects continuation URLs outside graph.microsoft.com before dispatch', async () => {
    const request = vi.fn();
    const client = createMicrosoftGraphClient(transport(request));

    await expect(
      client.getDeltaPage('https://attacker.example/v1.0/me/mailFolders/inbox/messages/delta'),
    ).rejects.toThrow('OUTLOOK_UNTRUSTED_GRAPH_URL');
    expect(request).not.toHaveBeenCalled();
  });

  it('requests created Inbox messages newest-first within the recovery window', () => {
    const url = new URL(createOutlookInboxDeltaUrl(new Date('2026-07-28T12:00:00.000Z')));

    expect(url.origin).toBe('https://graph.microsoft.com');
    expect(url.pathname).toBe('/v1.0/me/mailFolders/inbox/messages/delta');
    expect(url.searchParams.get('changeType')).toBe('created');
    expect(url.searchParams.get('$filter')).toBe('receivedDateTime ge 2026-07-28T12:00:00.000Z');
    expect(url.searchParams.get('$orderby')).toBe('receivedDateTime desc');
  });
});
