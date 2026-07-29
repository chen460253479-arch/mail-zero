import { externalAccessRouter } from '../modules/external-integration/trpc/router';
import { type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { integrationsRouter } from './routes/integrations';
import { connectionsRouter } from './routes/connections';
import { categoriesRouter } from './routes/categories';
import { templatesRouter } from './routes/templates';
import { mailApiRouter } from '../modules/mail-api';
import { shortcutRouter } from './routes/shortcut';
import { settingsRouter } from './routes/settings';
import { getContext } from 'hono/context-storage';
import { notesRouter } from './routes/notes';
import { userRouter } from './routes/user';
import { meetRouter } from './routes/meet';
import { bimiRouter } from './routes/bimi';
import type { HonoContext } from '../ctx';
import { router } from './trpc';

export const appRouter = router({
  bimi: bimiRouter,
  categories: categoriesRouter,
  connections: connectionsRouter,
  externalAccess: externalAccessRouter,
  integrations: integrationsRouter,
  mail: mailApiRouter,
  notes: notesRouter,
  shortcut: shortcutRouter,
  settings: settingsRouter,
  user: userRouter,
  templates: templatesRouter,
  meet: meetRouter,
});

export type AppRouter = typeof appRouter;

export type Inputs = inferRouterInputs<AppRouter>;
export type Outputs = inferRouterOutputs<AppRouter>;

export const serverTrpc = () => {
  const c = getContext<HonoContext>();
  return appRouter.createCaller({
    c,
    sessionUser: c.var.sessionUser,
    externalSession: c.var.externalSession,
    auth: c.var.auth,
    services: c.var.services,
  });
};
