export type LoginMethod = 'email' | 'username';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const resolveLoginMethod = (account: string): LoginMethod =>
  emailPattern.test(account.trim()) ? 'email' : 'username';

export const requiresInitialPasswordChange = (session: {
  user: { role?: string | null; mustChangePassword?: boolean | null };
  session: { authMethod?: string | null };
}): boolean =>
  session.user.role === 'user' &&
  session.user.mustChangePassword === true &&
  session.session.authMethod !== 'launch';
