export type AccountRole = 'admin' | 'user';

export const getAccountRole = (
  session: { user?: unknown } | null | undefined,
): AccountRole | undefined => {
  const role = (session?.user as { role?: unknown } | undefined)?.role;
  return role === 'admin' || role === 'user' ? role : undefined;
};

export const isAdministrator = (session: { user?: unknown } | null | undefined): boolean =>
  getAccountRole(session) === 'admin';
