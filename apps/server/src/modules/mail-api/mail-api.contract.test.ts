import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => {
  class RuntimeBase {}
  return {
    env: {},
    DurableObject: RuntimeBase,
    RpcTarget: RuntimeBase,
    WorkerEntrypoint: RuntimeBase,
    WorkflowEntrypoint: RuntimeBase,
  };
});

import { mailApiRouter } from '.';

describe('unified local Mail API facade', () => {
  it('exports one nested Router with every canonical resource', () => {
    expect(Object.keys(mailApiRouter._def.record)).toEqual([
      'account',
      'mailbox',
      'email',
      'thread',
      'identity',
      'submission',
      'view',
      'action',
    ]);
  });
});
