import { describe, expect, it } from 'vitest';

import { receiveInboundSignal } from './receive-signal';

describe('inbound provider signal', () => {
  it('records the signal and enqueues provider-neutral discovery commands', async () => {
    const commands: unknown[] = [];
    const result = await receiveInboundSignal(
      {
        provider: 'gmail',
        externalAccount: ' User@Example.com ',
        cursorHint: '101',
      },
      {
        recordSignal: async (input) => {
          expect(input).toEqual({
            provider: 'gmail',
            externalAccount: 'user@example.com',
            cursorHint: '101',
          });
          return ['sync-1', 'sync-2'];
        },
        enqueue: async (command) => {
          commands.push(command);
        },
      },
    );

    expect(result).toEqual({ matched: 2 });
    expect(commands).toEqual([
      { type: 'discover', syncId: 'sync-1' },
      { type: 'discover', syncId: 'sync-2' },
    ]);
  });
});
