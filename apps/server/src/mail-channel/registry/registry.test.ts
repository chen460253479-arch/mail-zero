import { describe, expect, it } from 'vitest';

import {
  createMailChannelRegistry,
  MailChannelCapabilityError,
  UnsupportedMailChannelError,
} from './registry';
import type { MailChannelPlugin } from '../contracts';

const outbound = {
  createAdapter: async () => ({
    provider: 'gmail',
    send: async () => ({
      remoteMessageId: 'message-1',
      remoteThreadId: null,
      acceptedAt: new Date('2026-07-26T12:00:00.000Z'),
      providerCode: '200',
      safeResponse: 'accepted' as const,
    }),
    classifyError: () => ({
      kind: 'permanent_failure' as const,
      providerCode: null,
      safeResponse: 'permanent_failure' as const,
      retryAfter: null,
    }),
  }),
};

const gmail = {
  id: 'gmail',
  providerKey: 'gmail',
  displayName: 'Gmail',
  credentialTypes: new Set(['oauth2']),
  capabilities: new Set(['read_messages', 'push_sync']),
  nangoProviders: ['google-mail', 'google'],
  resolveIdentity: async () => ({
    email: 'owner@example.com',
    name: 'Owner',
    picture: '',
  }),
  inbound: {
    createAdapter: async () => ({
      provider: 'gmail',
      establishCheckpoint: async () => ({ version: 1, historyId: '100' }),
      discover: async () => ({
        events: [],
        checkpoint: { version: 1, historyId: '100' },
        nextPageToken: null,
      }),
      fetchRawMessage: async () => ({
        remoteMessageId: 'message-1',
        raw: new Uint8Array(),
        receivedAt: null,
      }),
      classifyError: () => 'permanent',
    }),
  },
  outbound,
} satisfies MailChannelPlugin;

const outlook = {
  id: 'outlook',
  providerKey: 'outlook',
  displayName: 'Outlook',
  credentialTypes: new Set(['oauth2']),
  capabilities: new Set(['read_messages']),
  resolveIdentity: async () => ({
    email: 'owner@example.com',
    name: 'Owner',
    picture: '',
  }),
} satisfies MailChannelPlugin;

describe('mail channel registry', () => {
  it('lists and resolves a registered plugin by canonical channel id', () => {
    const registry = createMailChannelRegistry([gmail]);

    expect(registry.list()).toEqual([gmail]);
    expect(registry.find('gmail')).toBe(gmail);
    expect(registry.get('gmail')).toBe(gmail);
  });

  it('rejects an unregistered channel', () => {
    const registry = createMailChannelRegistry([gmail]);

    expect(() => registry.get('outlook')).toThrowError(new UnsupportedMailChannelError('outlook'));
  });

  it('returns the registered inbound capability', () => {
    const registry = createMailChannelRegistry([gmail]);

    expect(registry.getInbound('gmail')).toBe(gmail.inbound);
  });

  it('returns the registered provider-neutral outbound capability', () => {
    const registry = createMailChannelRegistry([gmail]);

    expect(registry.getOutbound('gmail')).toBe(outbound);
  });

  it('rejects a channel that does not implement inbound mail', () => {
    const registry = createMailChannelRegistry([outlook]);

    expect(() => registry.getInbound('outlook')).toThrowError(
      new MailChannelCapabilityError('outlook', 'inbound'),
    );
  });

  it('rejects a channel that does not implement outbound mail', () => {
    const registry = createMailChannelRegistry([outlook]);

    expect(() => registry.getOutbound('outlook')).toThrowError(
      new MailChannelCapabilityError('outlook', 'outbound'),
    );
  });

  it('rejects duplicate channel registrations', () => {
    expect(() => createMailChannelRegistry([gmail, gmail])).toThrowError(
      new Error('Mail channel is already registered: gmail'),
    );
  });
});
