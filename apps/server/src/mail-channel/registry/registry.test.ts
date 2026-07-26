import { describe, expect, it } from 'vitest';

import {
  createMailChannelRegistry,
  MailChannelCapabilityError,
  UnsupportedMailChannelError,
} from './registry';
import type { MailChannelPlugin } from '../contracts';

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

  it('rejects a channel that does not implement inbound mail', () => {
    const registry = createMailChannelRegistry([outlook]);

    expect(() => registry.getInbound('outlook')).toThrowError(
      new MailChannelCapabilityError('outlook', 'inbound'),
    );
  });

  it('rejects duplicate channel registrations', () => {
    expect(() => createMailChannelRegistry([gmail, gmail])).toThrowError(
      new Error('Mail channel is already registered: gmail'),
    );
  });
});
