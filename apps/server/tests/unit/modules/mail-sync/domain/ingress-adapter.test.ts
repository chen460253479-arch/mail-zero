import { describe, expect, it } from 'vitest';

import {
  createInboundMailAdapterFactory,
  parseIngressScope,
  parseVersionedProviderState,
  type InboundMailAdapter,
} from '../../../../../src/modules/mail-sync/domain/ingress-adapter';

const createAdapter = (connectionId: string): InboundMailAdapter => ({
  provider: 'test',
  establishCheckpoint: async () => ({ version: 1, connectionId }),
  discover: async () => ({
    events: [],
    nextPageToken: null,
    checkpoint: { version: 1, connectionId },
  }),
  fetchRawMessage: async ({ remoteMessageId }) => ({
    remoteMessageId,
    raw: new Uint8Array(),
    receivedAt: null,
  }),
  classifyError: () => 'permanent',
});

describe('provider-neutral inbound adapter contract', () => {
  it('preserves opaque provider state after validating its version', () => {
    const state = parseVersionedProviderState({
      version: 2,
      nested: { cursor: '123' },
    });

    expect(state).toEqual({
      version: 2,
      nested: { cursor: '123' },
    });
  });

  it.each([null, {}, { version: 0 }, { version: 1.5 }, { version: 1, invalid: new Date() }])(
    'rejects an invalid provider state: %o',
    (state) => {
      expect(() => parseVersionedProviderState(state)).toThrow('MAIL_SYNC_INVALID_PROVIDER_STATE');
    },
  );

  it('accepts only the first-release Inbox incremental scope', () => {
    expect(
      parseIngressScope({
        version: 1,
        mailboxRoles: ['inbox'],
        initialSync: 'none',
      }),
    ).toEqual({
      version: 1,
      mailboxRoles: ['inbox'],
      initialSync: 'none',
    });

    expect(() =>
      parseIngressScope({
        version: 1,
        mailboxRoles: ['inbox'],
        initialSync: 'all',
      }),
    ).toThrow('MAIL_SYNC_UNSUPPORTED_SCOPE');
  });

  it('creates an isolated adapter for every connection', async () => {
    const seenConnections: string[] = [];
    const factory = createInboundMailAdapterFactory(async (connectionId) => {
      seenConnections.push(connectionId);
      return createAdapter(connectionId);
    });

    const first = await factory.create('connection-1');
    const second = await factory.create('connection-2');

    expect(seenConnections).toEqual(['connection-1', 'connection-2']);
    expect(first).not.toBe(second);
    await expect(first.establishCheckpoint(parseIngressScope())).resolves.toEqual({
      version: 1,
      connectionId: 'connection-1',
    });
    await expect(second.establishCheckpoint(parseIngressScope())).resolves.toEqual({
      version: 1,
      connectionId: 'connection-2',
    });
  });
});
