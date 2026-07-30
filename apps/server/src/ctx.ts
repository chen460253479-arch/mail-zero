import type { RuntimeServices } from './runtime/node/services';
import type { Auth } from './lib/auth';

export type SessionUser = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['user'];
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['session'];

export type MailAccessSubject = {
  kind: 'user';
  userId: string;
  isAdministrator: boolean;
};

export type HonoVariables = {
  auth: Auth;
  sessionUser?: SessionUser;
  authSession?: AuthSession;
  traceId?: string;
  requestId?: string;
  services?: RuntimeServices;
};

export type HonoContext = { Variables: HonoVariables };
