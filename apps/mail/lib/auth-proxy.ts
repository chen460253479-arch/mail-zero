import { getServerBackendUrl } from './server-backend-url';
import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/client';
import type { Auth } from '@zero/server/auth';

const authClient = createAuthClient({
  baseURL: getServerBackendUrl(),
  fetchOptions: {
    credentials: 'include',
  },
  plugins: [inferAdditionalFields<Auth>(), usernameClient()],
});

export const authProxy = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const session = await authClient.getSession({
        fetchOptions: { headers, credentials: 'include' },
      });
      if (session.error) {
        console.error(`Failed to get session: ${session.error}`, session);
        return null;
      }
      return session.data;
    },
  },
};
