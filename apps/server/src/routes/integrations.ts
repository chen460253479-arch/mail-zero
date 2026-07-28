import { Hono } from 'hono';

import { createPostgresConnectionRepository } from '../modules/mail-accounts/postgres/connection-repository';
import { provisionGmailMailboxInDatabase } from '../modules/mail-accounts/runtime/provision-gmail-mailbox';
import { createChannelConfigRepository } from '../integrations/core/channel-config-repository';
import { normalizeMailboxEmail } from '../modules/mail-accounts/application/mailbox-identity';
import { GmailOAuthError } from '../modules/mail-accounts/application/connect-gmail-oauth';
import { createSystemIntegrationRepository } from '../integrations/core/repository';
import { createGmailOAuthApplication } from '../runtime/mail/gmail-oauth';
import { assertAdministrator } from '../integrations/core/permissions';
import type { HonoContext } from '../ctx';
import { createDb, type DB } from '../db';

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
  db: DB;
  repository: ReturnType<typeof createSystemIntegrationRepository>;
}) =>
  createGmailOAuthApplication({
    repository: c.repository,
    saveMailbox: async (userId, mailbox, authorization) => {
      const result = await createPostgresConnectionRepository(c.db).saveBinding({
        userId,
        existingMailboxId: null,
        mailbox: {
          ...mailbox,
          normalizedEmail: normalizeMailboxEmail(mailbox.email),
        },
        authorization,
      });
      await provisionGmailMailboxInDatabase(c.db, c.env, {
        userId,
        connectionId: result.id,
        identity: {
          email: mailbox.email,
          name: mailbox.name,
        },
      });
      return result;
    },
    encryptionKey: c.env.CREDENTIAL_ENCRYPTION_KEY,
    backendUrl: c.env.VITE_PUBLIC_BACKEND_URL,
  });

const assertZeroOAuthSelected = async (db: DB): Promise<void> => {
  const config = await createChannelConfigRepository(db).get('gmail');
  if (config?.authSource !== 'zero_oauth') {
    throw new GmailOAuthError('GMAIL_OAUTH_NOT_CONFIGURED');
  }
};

integrationOAuthRouter.get('/gmail/connect/start', async (c) => {
  const sessionUser = c.var.sessionUser;
  if (!sessionUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const { db, conn } = createDb(c.env.HYPERDRIVE.connectionString);
  try {
    await assertZeroOAuthSelected(db);
    const result = await createService({
      env: c.env,
      db,
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
    await assertZeroOAuthSelected(db);
    await createService({
      env: c.env,
      db,
      repository: createSystemIntegrationRepository(db),
    }).completeMailboxAuthorization({ ...input, userId: sessionUser.id });
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
        '/settings/integrations/gmail',
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
      db,
      repository: createSystemIntegrationRepository(db),
    }).completeValidation({ ...input, adminId: sessionUser.id });
    return c.redirect(
      resultRedirect(
        c.env.VITE_PUBLIC_APP_URL,
        '/settings/integrations/gmail',
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
