import { createContext, useContext, type PropsWithChildren } from 'react';

export type AppAccessContext =
  | {
      mode: 'anonymous';
      cacheSubject: null;
    }
  | {
      mode: 'user';
      cacheSubject: `user:${string}`;
    };

export const resolveAppAccess = (input: { userId: string | null }): AppAccessContext => {
  if (input.userId !== null) {
    return {
      mode: 'user',
      cacheSubject: `user:${input.userId}`,
    };
  }
  return {
    mode: 'anonymous',
    cacheSubject: null,
  };
};

export const loadAppAccess = async (input: {
  userId: string | null;
}): Promise<AppAccessContext> => resolveAppAccess(input);

const AccessContext = createContext<AppAccessContext>({
  mode: 'anonymous',
  cacheSubject: null,
});

export function AppAccessProvider({
  access,
  children,
}: PropsWithChildren<{ access: AppAccessContext }>) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

export const useAppAccess = (): AppAccessContext => useContext(AccessContext);
