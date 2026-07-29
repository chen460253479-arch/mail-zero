import { Hono } from 'hono';

import {
  ChannelOAuthError,
  type ZeroOAuthChannelId,
} from '../modules/mail-accounts/application/connect-channel-oauth';
import { createPostgresConnectionRepository } from '../modules/mail-accounts/postgres/connection-repository';
import { provisionGmailMailboxInDatabase } from '../modules/mail-accounts/runtime/provision-gmail-mailbox';
import { createChannelConfigRepository } from '../integrations/core/channel-config-repository';
import { normalizeMailboxEmail } from '../modules/mail-accounts/application/mailbox-identity';
import { GmailOAuthError } from '../modules/mail-accounts/application/connect-gmail-oauth';
import { createSystemIntegrationRepository } from '../integrations/core/repository';
import { createChannelOAuthApplication } from '../runtime/mail/channel-oauth';
import { createGmailOAuthApplication } from '../runtime/mail/gmail-oauth';
import { assertAdministrator } from '../integrations/core/permissions';
import type { RuntimeServices } from '../runtime/node/services';
import type { HonoContext } from '../ctx';
import type { ZeroEnv } from '../env';
import type { DB } from '../db';

const integrationOAuthRouter = new Hono<HonoContext>();

const resultRedirect = (
  appUrl: string,
  path: string,
  key: 'gmailValidation' | 'gmailConnection' | 'channelValidation' | 'channelConnection',
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
  env: ZeroEnv;
  runtime: RuntimeServices;
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
      await provisionGmailMailboxInDatabase(c.db, c.runtime, {
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

const channelFromParam = (value: string): ZeroOAuthChannelId | null =>
  value === 'outlook' || value === 'zoho_mail' ? value : null;

const assertChannelZeroOAuthSelected = async (
  db: DB,
  channelId: ZeroOAuthChannelId,
): Promise<void> => {
  const config = await createChannelConfigRepository(db).get(channelId);
  if (config?.authSource !== 'zero_oauth') {
    throw new ChannelOAuthError('CHANNEL_OAUTH_NOT_CONFIGURED');
  }
};

integrationOAuthRouter.get('/gmail/connect/start', async (c) => {
  const sessionUser = c.var.sessionUser;
  if (!sessionUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const db = c.var.services!.database.db;
  const environment = c.var.services!.environment;
  try {
    await assertZeroOAuthSelected(db);
    const result = await createService({
      env: environment,
      runtime: c.var.services!,
      db,
      repository: createSystemIntegrationRepository(db),
    }).startMailboxAuthorization(sessionUser.id);
    return c.redirect(result.authorizationUrl);
  } catch (error) {
    const code = error instanceof GmailOAuthError ? error.code : 'GMAIL_OAUTH_AUTHORIZATION_FAILED';
    return c.json({ error: code }, 412);
  }
});

integrationOAuthRouter.get('/gmail/connect/callback', async (c) => {
  const failure = () =>
    c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
        '/settings/connections',
        'gmailConnection',
        'error',
      ),
    );
  const sessionUser = c.var.sessionUser;
  const input = getOAuthInput(c.req.url);
  if (!sessionUser || !input) return failure();

  const db = c.var.services!.database.db;
  const environment = c.var.services!.environment;
  try {
    await assertZeroOAuthSelected(db);
    await createService({
      env: environment,
      runtime: c.var.services!,
      db,
      repository: createSystemIntegrationRepository(db),
    }).completeMailboxAuthorization({ ...input, userId: sessionUser.id });
    return c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
        '/settings/connections',
        'gmailConnection',
        'success',
      ),
    );
  } catch {
    return failure();
  }
});

integrationOAuthRouter.get('/gmail/validation/callback', async (c) => {
  const failure = () =>
    c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
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

  const db = c.var.services!.database.db;
  try {
    await createService({
      env: c.var.services!.environment,
      runtime: c.var.services!,
      db,
      repository: createSystemIntegrationRepository(db),
    }).completeValidation({ ...input, adminId: sessionUser.id });
    return c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
        '/settings/integrations/gmail',
        'gmailValidation',
        'success',
      ),
    );
  } catch {
    return failure();
  }
});

integrationOAuthRouter.get('/:channelId/connect/start', async (c) => {
  const channelId = channelFromParam(c.req.param('channelId'));
  const sessionUser = c.var.sessionUser;
  if (!channelId) return c.json({ error: 'MAIL_CHANNEL_UNAVAILABLE' }, 404);
  if (!sessionUser) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const db = c.var.services!.database.db;
  try {
    await assertChannelZeroOAuthSelected(db, channelId);
    const result = await createChannelOAuthApplication(
      db,
      c.var.services!,
      channelId,
    ).startMailboxAuthorization(sessionUser.id);
    return c.redirect(result.authorizationUrl);
  } catch (error) {
    const code =
      error instanceof ChannelOAuthError ? error.code : 'CHANNEL_OAUTH_AUTHORIZATION_FAILED';
    return c.json({ error: code }, 412);
  }
});

integrationOAuthRouter.get('/:channelId/connect/callback', async (c) => {
  const channelId = channelFromParam(c.req.param('channelId'));
  if (!channelId) return c.json({ error: 'MAIL_CHANNEL_UNAVAILABLE' }, 404);
  const failure = () =>
    c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
        '/settings/connections',
        'channelConnection',
        'error',
      ),
    );
  const sessionUser = c.var.sessionUser;
  const input = getOAuthInput(c.req.url);
  if (!sessionUser || !input) return failure();
  const db = c.var.services!.database.db;
  try {
    await assertChannelZeroOAuthSelected(db, channelId);
    await createChannelOAuthApplication(
      db,
      c.var.services!,
      channelId,
    ).completeMailboxAuthorization({
      ...input,
      userId: sessionUser.id,
    });
    return c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
        '/settings/connections',
        'channelConnection',
        'success',
      ),
    );
  } catch {
    return failure();
  }
});

integrationOAuthRouter.get('/:channelId/validation/callback', async (c) => {
  const channelId = channelFromParam(c.req.param('channelId'));
  if (!channelId) return c.json({ error: 'MAIL_CHANNEL_UNAVAILABLE' }, 404);
  const integrationPath = channelId;
  const failure = () =>
    c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
        `/settings/integrations/${integrationPath}`,
        'channelValidation',
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
  const db = c.var.services!.database.db;
  try {
    await createChannelOAuthApplication(db, c.var.services!, channelId).completeValidation({
      ...input,
      adminId: sessionUser.id,
    });
    return c.redirect(
      resultRedirect(
        c.var.services!.config.publicAppUrl,
        `/settings/integrations/${integrationPath}`,
        'channelValidation',
        'success',
      ),
    );
  } catch {
    return failure();
  }
});

export { integrationOAuthRouter };
