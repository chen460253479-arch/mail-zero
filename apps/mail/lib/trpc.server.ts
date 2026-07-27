import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { getServerBackendUrl } from './server-backend-url';
import type { AppRouter } from '@zero/server/trpc';
import superjson from 'superjson';

const getUrl = () => getServerBackendUrl() + '/api/trpc';

export const getServerTrpc = (req: Request) =>
  createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        maxItems: 1,
        url: getUrl(),
        transformer: superjson,
        headers: req.headers,
      }),
    ],
  });
