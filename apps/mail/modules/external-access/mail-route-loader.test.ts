import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn(async () => null));

vi.mock('@/components/mail/mail', () => ({
  MailLayout: () => null,
}));
vi.mock('@/hooks/use-labels', () => ({
  useLabels: () => ({ userLabels: [], isLoading: false }),
}));
vi.mock('@/hooks/use-connections', () => ({
  useActiveConnection: () => ({ data: null }),
}));
vi.mock('@/lib/auth-proxy', () => ({
  authProxy: {
    api: {
      getSession,
    },
  },
}));

import { clientLoader } from '../../app/(routes)/mail/[folder]/page';

describe('external mail route loader', () => {
  beforeEach(() => {
    getSession.mockClear();
  });

  it('allows the parent-authorized external session to open the inbox', async () => {
    const result = await clientLoader({
      params: {
        folder: 'inbox',
      },
      request: new Request('https://mail.zero.test/mail/inbox', {
        headers: {
          cookie: 'zero-external-session=external-session-token',
        },
      }),
    } as never);

    expect(result).toEqual({
      folder: 'inbox',
    });
    expect(getSession).not.toHaveBeenCalled();
  });
});
