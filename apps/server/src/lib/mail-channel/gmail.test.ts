import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMailboxIdentity = vi.fn();

vi.mock('../driver/google', () => ({
  GoogleMailManager: class {
    getMailboxIdentity = getMailboxIdentity;
  },
}));

import { gmailChannel } from './gmail';

describe('Gmail channel identity', () => {
  beforeEach(() => {
    getMailboxIdentity.mockReset();
  });

  it('resolves the mailbox through the Gmail profile endpoint', async () => {
    getMailboxIdentity.mockResolvedValue({
      email: 'User@Example.com',
      name: '',
      picture: '',
    });

    await expect(
      gmailChannel.resolveIdentity({
        auth: {
          userId: 'user-1',
          accessToken: 'access-token',
          refreshToken: '',
          email: '',
        },
      }),
    ).resolves.toEqual({
      email: 'User@Example.com',
      name: '',
      picture: '',
    });
    expect(getMailboxIdentity).toHaveBeenCalledOnce();
  });
});
