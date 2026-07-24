import { Hono } from 'hono';

import { GmailOAuthError, GmailOAuthService } from '../lib/integrations/gmail-oauth-service';
import { createSystemIntegrationRepository } from '../lib/integrations/repository';
import { GoogleGmailOAuthGateway } from '../lib/integrations/google-gmail-oauth';
import { assertAdministrator } from '../lib/integrations/permissions';
import { getZeroDB } from '../lib/server-utils';
import type { HonoContext } from '../ctx';
import { createDb } from '../db';

export const gmailOAuthRedirectUris = (backendUrl: string) => {
  const baseUrl = backendUrl.replace(/\/+$/, '');
  return {
    validation: `${baseUrl}/api/integrations/gmail/validation/callback`,
    mailbox: `${baseUrl}/api/integrations/gmail/connect/callback`,
  };
};

const integrationOAuthRouter = new Hono<HonoContext>();

const resultRedirect = (
  appUrl: string,
  path: string,
  key: 'gmailValidation' | 'gmailConnection',
  result: 'success' | 'error',
): string => {
  const url = new URL(path, `${appUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set(key, result);
  return url.toString();
};

const getOAuthInput = (url: string): { state: string; code: string } | null => {
  const parsed = new URL(url);
  const state = parsed.searchParams.get('state');
  const code = parsed.searchParams.get('code');
  return state && code ? { state, code } : null;
};

const createService = (c: {
  env: HonoContext['Bindings'];
  repository: ReturnType<typeof createSystemIntegrationRepository>;
}) =>
  new GmailOAuthService({
    repository: c.repository,
    mailboxRepository: {
      save: async (userId, mailbox, authorization) =>
        await (await getZeroDB(userId)).createMailboxWithAuthorization(mailbox, authorization),
    },
    gateway: new GoogleGmailOAuthGateway(),
    encryptionKey: c.env.CREDENTIAL_ENCRYPTION_KEY,
    redirectUris: gmailOAuthRedirectUris(c.env.VITE_PUBLIC_BACKEND_URL),
    now: () => new Date(),
  });

integrationOAuthRouter.get('/gmail/connect/start', async (c) => {
  const sessionUser = c.var.sessionUser;
  if (!sessionUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const { db, conn } = createDb(c.env.HYPERDRIVE.connectionString);
  try {
    const result = await createService({
      env: c.env,
      repository: createSystemIntegrationRepository(db),
    }).startMailboxAuthorization(sessionUser.id);
    return c.redirect(result.authorizationUrl);
  } catch (error) {
    const code = error instanceof GmailOAuthError ? error.code : 'GMAIL_OAUTH_AUTHORIZATION_FAILED';
    return c.json({ error: code }, 412);
  } finally {
    await conn.end();
  }
});

integrationOAuthRouter.get('/gmail/connect/callback', async (c) => {
  const failure = () =>
    c.redirect(
      resultRedirect(
        c.env.VITE_PUBLIC_APP_URL,
        '/settings/connections',
        'gmailConnection',
        'error',
      ),
    );
  const sessionUser = c.var.sessionUser;
  const input = getOAuthInput(c.req.url);
  if (!sessionUser || !input) return failure();

  const { db, conn } = createDb(c.env.HYPERDRIVE.connectionString);
  try {
    const result = await createService({
      env: c.env,
      repository: createSystemIntegrationRepository(db),
    }).completeMailboxAuthorization({ ...input, userId: sessionUser.id });
    if (c.env.GOOGLE_S_ACCOUNT && c.env.GOOGLE_S_ACCOUNT !== '{}') {
      await c.env.subscribe_queue.send({
        connectionId: result.id,
        providerId: 'google',
      });
    }
    return c.redirect(
      resultRedirect(
        c.env.VITE_PUBLIC_APP_URL,
        '/settings/connections',
        'gmailConnection',
        'success',
      ),
    );
  } catch {
    return failure();
  } finally {
    await conn.end();
  }
});

integrationOAuthRouter.get('/gmail/validation/callback', async (c) => {
  const failure = () =>
    c.redirect(
      resultRedirect(
        c.env.VITE_PUBLIC_APP_URL,
        '/settings/integrations',
        'gmailValidation',
        'error',
      ),
    );
  const sessionUser = c.var.sessionUser;
  const input = getOAuthInput(c.req.url);
  if (!sessionUser || !input) return failure();

  try {
    assertAdministrator(sessionUser);
  } catch {
    return failure();
  }

  const { db, conn } = createDb(c.env.HYPERDRIVE.connectionString);
  try {
    await createService({
      env: c.env,
      repository: createSystemIntegrationRepository(db),
    }).completeValidation({ ...input, adminId: sessionUser.id });
    return c.redirect(
      resultRedirect(
        c.env.VITE_PUBLIC_APP_URL,
        '/settings/integrations',
        'gmailValidation',
        'success',
      ),
    );
  } catch {
    return failure();
  } finally {
    await conn.end();
  }
});

export { integrationOAuthRouter };
