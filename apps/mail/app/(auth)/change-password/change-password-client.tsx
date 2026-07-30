import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';

type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

type PasswordChangeDependencies = {
  changePassword(input: PasswordChangeInput): Promise<unknown>;
  navigate(path: string, options: { replace: boolean }): void;
};

export const submitPasswordChange = async (
  input: PasswordChangeInput,
  dependencies: PasswordChangeDependencies,
): Promise<void> => {
  await dependencies.changePassword(input);
  dependencies.navigate('/mail/inbox', { replace: true });
};

export function ChangePasswordClient() {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const changePassword = useMutation(trpc.user.changePassword.mutationOptions());
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    if (newPassword.length < 12) {
      setError('The new password must contain at least 12 characters');
      return;
    }
    if (newPassword !== confirmation) {
      setError('The new passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different');
      return;
    }
    try {
      await submitPasswordChange(
        { currentPassword, newPassword },
        {
          changePassword: changePassword.mutateAsync,
          navigate,
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to change the password');
    }
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#111111] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <img src="/white-icon.svg" alt="Zero" className="mx-auto mb-5 h-10 w-10" />
          <h1 className="text-3xl font-semibold text-white">Set a new password</h1>
          <p className="mt-2 text-sm text-white/55">
            Change the initial password before opening your mailbox
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-white/80">Current password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              className="h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-white/80">New password</span>
            <input
              autoComplete="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={12}
              className="h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-white/80">Confirm new password</span>
            <input
              autoComplete="new-password"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={12}
              className="h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={changePassword.isPending}
            className="h-11 w-full bg-[#006FFE] text-white hover:bg-[#005ed8]"
          >
            {changePassword.isPending ? 'Updating…' : 'Change password'}
          </Button>
        </form>
      </div>
    </main>
  );
}
