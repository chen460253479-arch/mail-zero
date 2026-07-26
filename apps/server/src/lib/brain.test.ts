import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSubscriptionFactory, resetConnection, subscribe } = vi.hoisted(() => ({
  getSubscriptionFactory: vi.fn(),
  resetConnection: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('./factories/subscription-factory.registry', () => ({
  getSubscriptionFactory,
}));
vi.mock('./server-utils', () => ({
  resetConnection,
}));
vi.mock('../env', () => ({
  env: {
    prompts_storage: {
      get: vi.fn(),
      put: vi.fn(),
    },
  },
}));
vi.mock('../pipelines', () => ({
  getPromptName: vi.fn(),
}));
vi.mock('./prompts', () => ({
  AiChatPrompt: vi.fn(() => ''),
  StyledEmailAssistantSystemPrompt: vi.fn(() => ''),
}));
vi.mock('./brain.fallback.prompts', () => ({
  ReSummarizeThread: '',
  SummarizeMessage: '',
  SummarizeThread: '',
}));

import { enableBrainFunction } from './brain';
import { EProviders } from '../types';

describe('subscription activation queue boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSubscriptionFactory.mockReturnValue({ subscribe });
  });

  it('rejects a failed subscription response so the queue can retry activation', async () => {
    subscribe.mockResolvedValue(new Response('failed', { status: 500 }));

    await expect(
      enableBrainFunction({ id: 'connection-1', providerId: EProviders.google }),
    ).rejects.toThrow('Subscription activation failed with status 500');
    expect(resetConnection).toHaveBeenCalledWith('connection-1');
  });

  it('completes a successful subscription without resetting the connection', async () => {
    subscribe.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      enableBrainFunction({ id: 'connection-1', providerId: EProviders.google }),
    ).resolves.toBeUndefined();
    expect(resetConnection).not.toHaveBeenCalled();
  });
});
