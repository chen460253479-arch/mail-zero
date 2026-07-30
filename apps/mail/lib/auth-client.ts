import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins';
import type { Auth } from '@zero/server/auth';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_PUBLIC_BACKEND_URL,
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [inferAdditionalFields<Auth>(), usernameClient()],
});

export const { signIn, signUp, signOut, useSession, getSession, $fetch } = authClient;
export type Session = Awaited<ReturnType<Auth['api']['getSession']>>;
