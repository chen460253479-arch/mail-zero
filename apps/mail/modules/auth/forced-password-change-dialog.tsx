import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

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

type PasswordFieldProps = {
  label: string;
  value: string;
  onChange(value: string): void;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
};

function PasswordField({ label, value, onChange, autoComplete, minLength }: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const visibilityLabel = isVisible
    ? m['pages.auth.changePassword.hidePassword']()
    : m['pages.auth.changePassword.showPassword']();

  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="relative">
        <input
          autoComplete={autoComplete}
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={minLength}
          className="border-input bg-background h-11 w-full rounded-lg border px-3 pr-11 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          type="button"
          aria-label={visibilityLabel}
          aria-pressed={isVisible}
          title={visibilityLabel}
          onClick={() => setIsVisible((visible) => !visible)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg outline-none transition-colors focus-visible:ring-2"
        >
          {isVisible ? (
            <EyeOff aria-hidden="true" size={18} />
          ) : (
            <Eye aria-hidden="true" size={18} />
          )}
        </button>
      </div>
    </label>
  );
}

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
          <PasswordField
            label={m['pages.auth.changePassword.currentPassword']()}
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />

          <PasswordField
            label={m['pages.auth.changePassword.newPassword']()}
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
            minLength={12}
          />

          <PasswordField
            label={m['pages.auth.changePassword.confirmPassword']()}
            autoComplete="new-password"
            value={confirmation}
            onChange={setConfirmation}
            minLength={12}
          />

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
