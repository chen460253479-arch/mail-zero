import type { CookieOptions } from 'hono/utils/cookie';

import type { RuntimeConfig } from '../../../runtime/node/config';

export const EXTERNAL_SESSION_COOKIE_NAME = 'zero-external-session';

export const externalSessionCookieOptions = (
  config: RuntimeConfig,
  expiresAt: Date,
): CookieOptions => ({
  httpOnly: true,
  path: '/',
  sameSite: 'Lax',
  secure: config.nodeEnv !== 'local',
  domain: config.cookieDomain,
  expires: expiresAt,
});
