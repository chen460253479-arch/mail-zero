import { QueryProvider } from './query-provider';
import type { PropsWithChildren } from 'react';

export function ServerProviders({
  children,
  userId,
}: PropsWithChildren<{ userId: string | null }>) {
  return <QueryProvider userId={userId}>{children}</QueryProvider>;
}
