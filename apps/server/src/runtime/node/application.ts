import { contextStorage } from 'hono/context-storage';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { trpcServer } from '@hono/trpc-server';
import { cors } from 'hono/cors';
import { Hono } from 'hono';

import { createExternalIntegrationRouter } from '../../modules/external-integration';
import { finalizeRequestTrace, TraceContext } from '../../lib/trace-context';
import { integrationOAuthRouter } from '../../routes/integrations';
import { registerMailBlobRoutes } from '../../modules/mail-api';
import type { RuntimeServices } from './services';
import { publicRouter } from '../../routes/auth';
import type { HonoContext } from '../../ctx';
import { appRouter } from '../../trpc';

const hashIpAddress = (ip: string | undefined): string | undefined => {
  if (!ip) return undefined;
  const salt = 'zero-mail-ip-salt-2024';
  let hash = 0;
  for (const character of ip + salt) {
    hash = (hash << 5) - hash + character.charCodeAt(0);
    hash &= hash;
  }
  return `ip_${Math.abs(hash).toString(16).padStart(8, '0')}`;
};

const coreIsReady = (services: RuntimeServices): boolean =>
  Object.values(services.readiness.snapshot).every(Boolean);

const createApi = (services: RuntimeServices) => {
  const api = new Hono<HonoContext>()
    .use(contextStorage())
    .use('*', async (c, next) => {
      c.set('services', services);
      const traceId = c.req.header('X-Trace-ID') || crypto.randomUUID();
      const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
      c.header('X-Trace-ID', traceId);
      c.header('X-Request-ID', requestId);
      c.set('traceId', traceId);
      c.set('requestId', requestId);

      const rawIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For');
      const trace = TraceContext.createTrace(traceId, {
        requestId,
        ip: hashIpAddress(rawIp),
        userAgent: c.req.header('User-Agent'),
      });
      const authSpan = TraceContext.startSpan(
        traceId,
        'authentication',
        {
          method: c.req.method,
          url: c.req.url,
          hasAuthHeader: !!c.req.header('Authorization'),
        },
        {
          'auth.method': c.req.header('Authorization') ? 'bearer_token' : 'session_cookie',
        },
      );

      await services.ensureAdmin();
      const auth = services.auth;
      c.set('auth', auth);
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      c.set('sessionUser', session?.user);

      if (c.req.header('Authorization') && !session?.user) {
        const tokenSpan = TraceContext.startSpan(
          traceId,
          'token_verification',
          { tokenPresent: true },
          { 'auth.token_type': 'jwt' },
        );
        const token = c.req.header('Authorization')?.split(' ')[1];
        if (token) {
          try {
            const localJwks = await auth.api.getJwks();
            const { payload } = await jwtVerify(token, createLocalJWKSet(localJwks));
            const userId = payload.sub;
            if (userId) {
              const authenticatedUser = await services.userWorkspace.forUser(userId).findUser();
              c.set('sessionUser', authenticatedUser);
              TraceContext.completeSpan(traceId, tokenSpan.id, { success: true, userId });
            } else {
              TraceContext.completeSpan(traceId, tokenSpan.id, {
                success: false,
                reason: 'no_user_id_in_token',
              });
            }
          } catch (error) {
            TraceContext.completeSpan(
              traceId,
              tokenSpan.id,
              { success: false, reason: 'token_verification_failed' },
              error instanceof Error ? error.message : 'Unknown token error',
            );
          }
        } else {
          TraceContext.completeSpan(traceId, tokenSpan.id, {
            success: false,
            reason: 'no_token_provided',
          });
        }
      }

      TraceContext.completeSpan(traceId, authSpan.id, {
        authenticated: !!c.var.sessionUser,
        userId: c.var.sessionUser?.id,
        authMethod: session?.user ? 'session' : c.req.header('Authorization') ? 'token' : 'none',
      });
      trace.metadata.userId = c.var.sessionUser?.id;
      trace.metadata.sessionId = c.var.sessionUser?.id || 'anonymous';
      const requestSpan = TraceContext.startSpan(traceId, 'request_processing', {
        authenticated: !!c.var.sessionUser,
        path: new URL(c.req.url).pathname,
      });

      let requestError: unknown;
      try {
        await next();
      } catch (error) {
        requestError = error;
        throw error;
      } finally {
        finalizeRequestTrace(c, requestSpan.id, c.res.status, requestError);
        c.set('sessionUser', undefined);
      }
    })
    .route('/public', publicRouter)
    .route('/api/integrations', integrationOAuthRouter)
    .on(['GET', 'POST', 'OPTIONS'], '/auth/*', (c) => c.var.auth.handler(c.req.raw))
    .use(
      trpcServer({
        endpoint: '/api/trpc',
        router: appRouter,
        createContext: (_, c) => ({
          c,
          services,
          auth: c.var.auth,
          sessionUser: c.var.sessionUser,
          traceId: c.var.traceId,
          requestId: c.var.requestId,
        }),
        allowMethodOverride: true,
        onError: ({ error }) => console.error('Error in TRPC handler:', error),
      }),
    )
    .onError(async (error, c) => {
      if (error instanceof Response) return error;
      console.error('Error in Hono handler:', error);
      return c.json(
        {
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    });

  registerMailBlobRoutes(api);
  return api;
};

export const createNodeApplication = (services: RuntimeServices) => {
  const api = createApi(services);
  return new Hono<HonoContext>()
    .use('*', async (c, next) => {
      c.set('services', services);
      await next();
    })
    .use(
      '*',
      cors({
        origin: (origin) => {
          if (!origin) return null;
          let hostname: string;
          try {
            hostname = new URL(origin).hostname;
          } catch {
            return null;
          }
          const cookieDomain = services.config.cookieDomain;
          return hostname === cookieDomain || hostname.endsWith(`.${cookieDomain}`) ? origin : null;
        },
        credentials: true,
        allowHeaders: ['Content-Type', 'Authorization'],
        exposeHeaders: ['X-Zero-Redirect'],
      }),
    )
    .post('/api/mail/channels/gmail/push', (c) => services.webhooks.gmail(c.req.raw))
    .post('/api/webhooks/mail/outlook', (c) => services.webhooks.outlook(c.req.raw))
    .post('/api/webhooks/mail/zoho/:endpointToken', (c) =>
      services.webhooks.zohoMail(c.req.raw, c.req.param('endpointToken')),
    )
    .route('/api/integrations', createExternalIntegrationRouter(services))
    .route('/api', api)
    .get('/health', (c) =>
      coreIsReady(services)
        ? c.json({ message: 'Zero Server is Up!' })
        : c.json(
            { message: 'Zero Server is starting', readiness: services.readiness.snapshot },
            503,
          ),
    )
    .get('/', (c) => c.redirect(services.config.publicAppUrl));
};
