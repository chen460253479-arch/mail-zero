import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { MailChannelCredentialContext } from '../../../../src/runtime/mail/channel-credential-context';
import { createChannelInboundAdapterFactory } from '../../../../src/runtime/mail/channel-inbound';
import type { MailChannelRegistry } from '../../../../src/mail-channel/registry';

const testRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(testRoot, '../../../..');
const source = readFileSync(resolve(serverRoot, 'src/runtime/mail/channel-inbound.ts'), 'utf8');

describe('provider-neutral inbound runtime helpers', () => {
  it('resolves adapters through the channel registry and a channel context factory', () => {
    expect(source).toContain('registry.getInbound');
    expect(source).toContain('context.channelId');
    expect(source).toContain('context.resolveCredential(false)');
    expect(source).not.toContain('gmail');
  });

  it('creates any registered inbound adapter from the connection credential context', async () => {
    const calls: unknown[] = [];
    const context = {
      channelId: 'outlook',
      authSource: 'nango',
      resolveCredential: async () => ({
        type: 'oauth2',
        accessToken: 'token',
        expiresAt: null,
        scope: 'Mail.Read',
      }),
      invalidateCredential: async () => undefined,
      markReconnectRequired: async () => undefined,
    } satisfies MailChannelCredentialContext;
    const adapter = {
      provider: 'outlook',
      establishCheckpoint: async () => ({ version: 1 }),
      discover: async () => ({
        events: [],
        checkpoint: { version: 1 },
        nextPageToken: null,
      }),
      fetchRawMessage: async () => {
        throw new Error('unused');
      },
      classifyError: () => 'retryable' as const,
    };
    const registry = {
      getInbound: (channelId: string) => {
        calls.push({ channelId });
        return {
          createAdapter: async (input: unknown) => {
            calls.push(input);
            return adapter;
          },
        };
      },
    } as unknown as MailChannelRegistry;

    const factory = createChannelInboundAdapterFactory(registry, async (connectionId) => {
      calls.push({ connectionId });
      return context;
    });

    await expect(factory.create('connection-1')).resolves.toBe(adapter);
    expect(calls).toEqual([
      { connectionId: 'connection-1' },
      { channelId: 'outlook' },
      {
        connectionId: 'connection-1',
        credential: {
          type: 'oauth2',
          accessToken: 'token',
          expiresAt: null,
          scope: 'Mail.Read',
        },
      },
    ]);
  });
});
