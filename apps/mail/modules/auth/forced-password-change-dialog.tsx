import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';
import { m } from '@/paraglide/messages';

type PasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};

type ForcedPasswordChangeDependencies = {
  changePassword(input: PasswordChangeInput): Promise<unknown>;
  reloadInbox(): void;
};

export const submitForcedPasswordChange = async (
  input: PasswordChangeInput,
  dependencies: ForcedPasswordChangeDependencies,
): Promise<void> => {
  await dependencies.changePassword(input);
  dependencies.reloadInbox();
};

const reloadInbox = () => window.location.assign('/mail/inbox');

export function ForcedPasswordChangeDialog() {
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
      setError(m['pages.auth.changePassword.minimumLength']({ count: 12 }));
      return;
    }
    if (newPassword !== confirmation) {
      setError(m['pages.auth.changePassword.mismatch']());
      return;
    }
    if (newPassword === currentPassword) {
      setError(m['pages.auth.changePassword.mustDiffer']());
      return;
    }
    try {
      await submitForcedPasswordChange(
        { currentPassword, newPassword },
        {
          changePassword: changePassword.mutateAsync,
          reloadInbox,
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m['pages.auth.changePassword.failed']());
    }
  };

  return (
    <Dialog open>
      <DialogContent
        showOverlay
        data-forced-password-dialog="true"
        className="max-h-[90vh] max-w-md overflow-y-auto"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="mb-6">
          <DialogTitle className="text-2xl">{m['pages.auth.changePassword.title']()}</DialogTitle>
          <DialogDescription>{m['pages.auth.changePassword.description']()}</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium">
              {m['pages.auth.changePassword.currentPassword']()}
            </span>
            <input
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              className="border-input bg-background h-11 w-full rounded-lg border px-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">
              {m['pages.auth.changePassword.newPassword']()}
            </span>
            <input
              autoComplete="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={12}
              className="border-input bg-background h-11 w-full rounded-lg border px-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">
              {m['pages.auth.changePassword.confirmPassword']()}
            </span>
            <input
              autoComplete="new-password"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={12}
              className="border-input bg-background h-11 w-full rounded-lg border px-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={changePassword.isPending}
            className="h-11 w-full bg-[#006FFE] text-white hover:bg-[#005ed8]"
          >
            {changePassword.isPending
              ? m['pages.auth.changePassword.saving']()
              : m['pages.auth.changePassword.save']()}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
