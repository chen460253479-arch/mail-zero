import { setCookie } from 'hono/cookie';
import type { Context } from 'hono';

import { EXTERNAL_SESSION_COOKIE_NAME, externalSessionCookieOptions } from '../session/cookie';
import type { RuntimeServices } from '../../../runtime/node/services';
import type { ExternalBrowserSession } from '../contracts/access';
import { launchCodeInputSchema } from '../contracts/access';
import { ExternalIntegrationError } from '../errors';

export type ConsumeExternalLaunchCode = (
  input: { launchCode: string },
  services: RuntimeServices,
) => Promise<{
  sessionToken: string;
  session: ExternalBrowserSession;
}>;

export const handleExternalLaunch = async (
  context: Context,
  services: RuntimeServices,
  consume: ConsumeExternalLaunchCode,
): Promise<Response> => {
  const body = await context.req.parseBody().catch(() => null);
  const parsed = launchCodeInputSchema.safeParse(body);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_REQUEST' }, 400);
  }
  try {
    const result = await consume(parsed.data, services);
    setCookie(
      context,
      EXTERNAL_SESSION_COOKIE_NAME,
      result.sessionToken,
      externalSessionCookieOptions(services.config, result.session.expiresAt),
    );
    return context.redirect(new URL('/mail/inbox', services.config.publicAppUrl).toString(), 303);
  } catch (error) {
    if (error instanceof ExternalIntegrationError && error.code === 'LAUNCH_CODE_INVALID') {
      return context.json({ error: error.code }, 400);
    }
    throw error;
  }
};
