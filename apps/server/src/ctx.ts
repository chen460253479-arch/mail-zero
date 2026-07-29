import type {
  ExternalBrowserSession,
  GrantedMailboxScope,
} from './modules/external-integration/contracts/access';
import type { RuntimeServices } from './runtime/node/services';
import type { Auth } from './lib/auth';

export type SessionUser = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['user'];

export type MailAccessSubject =
  | {
      kind: 'user';
      userId: string;
    }
  | {
      kind: 'external';
      sessionId: string;
      ownerUserId: 'zero-external-integration';
      scopes: GrantedMailboxScope[];
      activeConnectionId: string;
    };

export type HonoVariables = {
  auth: Auth;
  sessionUser?: SessionUser;
  externalSession?: ExternalBrowserSession;
  traceId?: string;
  requestId?: string;
  services?: RuntimeServices;
};

export type HonoContext = { Variables: HonoVariables };
