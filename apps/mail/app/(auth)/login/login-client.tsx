import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { signIn } from '@/lib/auth-client';

export function LoginClient() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setIsSubmitting(true);

    try {
      const result = await signIn.email({
        email: email.trim().toLowerCase(),
        password,
        rememberMe: true,
      });

      if (result.error) {
        setError(result.error.message || 'Invalid administrator email or password');
        return;
      }

      navigate('/mail', { replace: true });
    } catch {
      setError('Unable to reach the Zero server');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#111111] px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <img src="/white-icon.svg" alt="Zero" className="mx-auto mb-5 h-10 w-10" />
          <h1 className="text-3xl font-semibold text-white">Sign in to Zero</h1>
          <p className="mt-2 text-sm text-white/55">Use the local instance administrator account</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-white/80">Email</span>
            <input
              autoComplete="email"
              autoFocus
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-white/80">Password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              className="h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-11 w-full bg-[#006FFE] text-white hover:bg-[#005ed8]"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs leading-5 text-white/40">
          Public registration and email verification are disabled for this private instance.
        </p>
      </div>
    </main>
  );
}
