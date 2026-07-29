import { createContext, useContext, type PropsWithChildren } from 'react';

export type AppAccessContext =
  | {
      mode: 'anonymous';
      cacheSubject: null;
    }
  | {
      mode: 'user';
      cacheSubject: `user:${string}`;
    }
  | {
      mode: 'external';
      cacheSubject: `external:${string}`;
    };

export const resolveAppAccess = (input: {
  userId: string | null;
  externalSessionId: string | null;
}): AppAccessContext => {
  if (input.userId !== null) {
    return {
      mode: 'user',
      cacheSubject: `user:${input.userId}`,
    };
  }
  if (input.externalSessionId !== null) {
    return {
      mode: 'external',
      cacheSubject: `external:${input.externalSessionId}`,
    };
  }
  return {
    mode: 'anonymous',
    cacheSubject: null,
  };
};

export const loadAppAccess = async (input: {
  userId: string | null;
  loadExternalSessionId: () => Promise<string | null>;
}): Promise<AppAccessContext> => {
  if (input.userId !== null) {
    return resolveAppAccess({
      userId: input.userId,
      externalSessionId: null,
    });
  }

  try {
    return resolveAppAccess({
      userId: null,
      externalSessionId: await input.loadExternalSessionId(),
    });
  } catch {
    return resolveAppAccess({
      userId: null,
      externalSessionId: null,
    });
  }
};

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
