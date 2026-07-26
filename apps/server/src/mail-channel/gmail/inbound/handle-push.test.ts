import { describe, expect, it } from 'vitest';

import { handleGmailPush } from './handle-push';

describe('Gmail inbound push handler', () => {
  it('turns a valid Gmail notification into a generic signal command', async () => {
    const commands: unknown[] = [];

    await expect(
      handleGmailPush(
        {
          emailAddress: 'User@Example.com',
          historyId: '123',
        },
        {
          enqueue: async (command) => {
            commands.push(command);
          },
        },
      ),
    ).resolves.toEqual({ accepted: true });

    expect(commands).toEqual([
      {
        type: 'signal',
        provider: 'gmail',
        externalAccount: 'user@example.com',
        cursorHint: '123',
      },
    ]);
  });

  it.each([
    null,
    {},
    { emailAddress: '', historyId: '123' },
    { emailAddress: 'user@example.com', historyId: '' },
    { emailAddress: 'not-an-email', historyId: '123' },
  ])('rejects malformed notification payload %o', async (payload) => {
    await expect(
      handleGmailPush(payload, {
        enqueue: async () => {
          throw new Error('must not enqueue');
        },
      }),
    ).resolves.toEqual({ accepted: false });
  });
});
