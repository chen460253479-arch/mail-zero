import { AppAccessProvider, type AppAccessContext } from '@/modules/external-access/access-context';
import { QueryProvider } from './query-provider';
import type { PropsWithChildren } from 'react';

export function ServerProviders({
  children,
  access,
}: PropsWithChildren<{ access: AppAccessContext }>) {
  return (
    <AppAccessProvider access={access}>
      <QueryProvider cacheSubject={access.cacheSubject}>{children}</QueryProvider>
    </AppAccessProvider>
  );
}
