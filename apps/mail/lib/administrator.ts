export const isAdministrator = (session: { user?: unknown } | null | undefined): boolean =>
  (session?.user as { role?: unknown } | undefined)?.role === 'admin';
