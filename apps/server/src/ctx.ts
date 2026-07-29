import type { RuntimeServices } from './runtime/node/services';
import type { Auth } from './lib/auth';

export type SessionUser = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['user'];

export type HonoVariables = {
  auth: Auth;
  sessionUser?: SessionUser;
  traceId?: string;
  requestId?: string;
  services?: RuntimeServices;
};

export type HonoContext = { Variables: HonoVariables };
