import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock('@/providers/query-provider', () => ({
  useTRPC: () => ({
    user: {
      changePassword: {
        mutationOptions: () => ({}),
      },
    },
  }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (
    <div data-dialog-open={String(open)}>{children}</div>
  ),
  DialogContent: ({
    children,
    ...props
  }: PropsWithChildren<{ 'data-forced-password-dialog'?: string }>) => (
    <section data-forced-password-dialog={props['data-forced-password-dialog']}>{children}</section>
  ),
  DialogHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));

import {
  ForcedPasswordChangeDialog,
  submitForcedPasswordChange,
} from './forced-password-change-dialog';

describe('first password change submission', () => {
  it('updates the password and reloads the inbox without logging out', async () => {
    const changePassword = vi.fn(async () => ({ success: true }));
    const reloadInbox = vi.fn();
    const dependencies = { changePassword, reloadInbox };

    await submitForcedPasswordChange(
      {
        currentPassword: 'user_200',
        newPassword: 'new-secure-password',
      },
      dependencies,
    );

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'user_200',
      newPassword: 'new-secure-password',
    });
    expect(reloadInbox).toHaveBeenCalledOnce();
  });

  it('keeps the dialog open when the password mutation fails', async () => {
    const changePassword = vi.fn(async () => {
      throw new Error('INVALID_PASSWORD');
    });
    const reloadInbox = vi.fn();
    const dependencies = { changePassword, reloadInbox };

    await expect(
      submitForcedPasswordChange(
        {
          currentPassword: 'wrong-password',
          newPassword: 'new-secure-password',
        },
        dependencies,
      ),
    ).rejects.toThrow('INVALID_PASSWORD');
    expect(reloadInbox).not.toHaveBeenCalled();
  });

  it('renders as an always-open dialog without a close control', () => {
    const html = renderToStaticMarkup(<ForcedPasswordChangeDialog />);

    expect(html).toContain('data-forced-password-dialog="true"');
    expect(html).toContain('data-dialog-open="true"');
    expect(html).not.toContain('data-dialog-close');
  });
});
