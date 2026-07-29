import { enqueueDueMailOutboundWork, runMailOutboundCommand } from './runtime/mail/outbound';
import { enqueueDueMailIngressWork, runMailIngressCommand } from './runtime/mail/inbound';
import { MailOutboundError, parseMailOutboundCommand } from './modules/mail-outbound';
import { handleOutlookWebhookForEnvironment } from './runtime/mail/outlook-inbound';
import { parseMailIngressCommand } from './modules/mail-sync/application/commands';
import { startNangoValidationForEnvironment } from './integrations/nango/runtime';
import { handleZohoMailWebhookForEnvironment } from './runtime/mail/zoho-inbound';
import { handleGmailWebhookForEnvironment } from './runtime/mail/gmail-inbound';
import { wakeDueMailSnoozes } from './modules/mail-snooze/runtime/environment';
import { registerMailBlobRoutes } from './modules/mail-api';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { getUserWorkspace } from './lib/server-utils';
import { MailSyncError } from './modules/mail-sync';

import { ensureConfiguredAdmin } from './lib/admin-provisioning';
import { integrationOAuthRouter } from './routes/integrations';
import { contextStorage } from 'hono/context-storage';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { trpcServer } from '@hono/trpc-server';
import { publicRouter } from './routes/auth';
import { env, type ZeroEnv } from './env';
import type { HonoContext } from './ctx';
import { createAuth } from './lib/auth';
import { appRouter } from './trpc';
import { cors } from 'hono/cors';
import { Hono } from 'hono';

// Utility function to hash IP addresses for PII protection
function hashIpAddress(ip: string | undefined): string | undefined {
  if (!ip) return undefined;

  // Simple but effective hash for IP addresses
  // This preserves uniqueness while protecting PII
  const salt = 'zero-mail-ip-salt-2024'; // Consider using env variable for production
  let hash = 0;
  const str = ip + salt;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Return a prefixed hex representation
  return `ip_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

const api = new Hono<HonoContext>()
  .use(contextStorage())
  .use('*', async (c, next) => {
    // Initialize request tracing using headers (no context pollution)
    const traceId = c.req.header('X-Trace-ID') || crypto.randomUUID();
    const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();

    // Set trace ID in response headers for client correlation
    c.header('X-Trace-ID', traceId);
    c.header('X-Request-ID', requestId);

    // Store trace ID in context variables for TRPC access
    c.set('traceId', traceId);
    c.set('requestId', requestId);

    const { finalizeRequestTrace, TraceContext } = await import('./lib/trace-context');

    // Create trace for this request
    const rawIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For');
    const trace = TraceContext.createTrace(traceId, {
      requestId,
      ip: hashIpAddress(rawIp), // Hash IP address to protect PII
      userAgent: c.req.header('User-Agent'),
    });

    // Start authentication span
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

    await ensureConfiguredAdmin();
    const auth = createAuth();
    c.set('auth', auth);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('sessionUser', session?.user);

    if (c.req.header('Authorization') && !session?.user) {
      // Start token verification span
      const tokenSpan = TraceContext.startSpan(
        traceId,
        'token_verification',
        {
          tokenPresent: true,
        },
        {
          'auth.token_type': 'jwt',
        },
      );

      const token = c.req.header('Authorization')?.split(' ')[1];

      if (token) {
        try {
          const localJwks = await auth.api.getJwks();
          const jwks = createLocalJWKSet(localJwks);

          const { payload } = await jwtVerify(token, jwks);
          const userId = payload.sub;

          if (userId) {
            const db = getUserWorkspace(userId);
            const user = await db.findUser();
            c.set('sessionUser', user);

            TraceContext.completeSpan(traceId, tokenSpan.id, {
              success: true,
              userId,
            });
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
            {
              success: false,
              reason: 'token_verification_failed',
            },
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

    // Complete auth span
    TraceContext.completeSpan(traceId, authSpan.id, {
      authenticated: !!c.var.sessionUser,
      userId: c.var.sessionUser?.id,
      authMethod: session?.user ? 'session' : c.req.header('Authorization') ? 'token' : 'none',
    });

    // Update trace metadata with user info
    trace.metadata.userId = c.var.sessionUser?.id;
    trace.metadata.sessionId = c.var.sessionUser?.id || 'anonymous';

    // Start request processing span
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
  .on(['GET', 'POST', 'OPTIONS'], '/auth/*', (c) => {
    return c.var.auth.handler(c.req.raw);
  })
  .use(
    trpcServer({
      endpoint: '/api/trpc',
      router: appRouter,
      createContext: (_, c) => {
        return { c, sessionUser: c.var['sessionUser'], db: c.var['db'] };
      },
      allowMethodOverride: true,
      onError: (opts) => {
        console.error('Error in TRPC handler:', opts.error);
      },
    }),
  )
  .onError(async (err, c) => {
    if (err instanceof Response) return err;
    console.error('Error in Hono handler:', err);
    return c.json(
      {
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  });

registerMailBlobRoutes(api);

const app = new Hono<HonoContext>()
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
        const cookieDomain = env.COOKIE_DOMAIN;
        if (!cookieDomain) return null;
        if (hostname === cookieDomain || hostname.endsWith('.' + cookieDomain)) {
          return origin;
        }
        return null;
      },
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Zero-Redirect'],
    }),
  )
  .route('/api', api)
  .get('/health', (c) => c.json({ message: 'Zero Server is Up!' }))
  .get('/', (c) => c.redirect(`${env.VITE_PUBLIC_APP_URL}`))
  .post('/api/mail/channels/gmail/push', (c) => handleGmailWebhookForEnvironment(c.env, c.req.raw))
  .post('/api/webhooks/mail/outlook', (c) => handleOutlookWebhookForEnvironment(c.env, c.req.raw))
  .post('/api/webhooks/mail/zoho/:endpointToken', (c) =>
    handleZohoMailWebhookForEnvironment(c.env, c.req.raw, c.req.param('endpointToken')),
  );
const handler = {
  async fetch(request: Request, env: ZeroEnv, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};

export default class Entry extends WorkerEntrypoint<ZeroEnv> {
  async fetch(request: Request): Promise<Response> {
    startNangoValidationForEnvironment(this.env, this.ctx);
    return handler.fetch(request, this.env, this.ctx);
  }
  async queue(batch: MessageBatch<unknown>) {
    startNangoValidationForEnvironment(this.env, this.ctx);
    switch (true) {
      case batch.queue.startsWith('mail-ingress-queue'): {
        const messages = batch.messages as Message<unknown>[];
        await Promise.all(
          messages.map(async (message) => {
            try {
              const command = parseMailIngressCommand(message.body);
              await runMailIngressCommand(this.env, command);
              message.ack();
            } catch (error) {
              console.error('[MAIL_INGRESS_QUEUE] command failed', error);
              if (error instanceof MailSyncError && error.classification === 'permanent') {
                message.ack();
              } else {
                message.retry({ delaySeconds: 60 });
              }
            }
          }),
        );
        return;
      }
      case batch.queue.startsWith('mail-outbound-queue'): {
        const messages = batch.messages as Message<unknown>[];
        await Promise.all(
          messages.map(async (message) => {
            try {
              const command = parseMailOutboundCommand(message.body);
              await runMailOutboundCommand(this.env, command);
              message.ack();
            } catch (error) {
              console.error('[MAIL_OUTBOUND_QUEUE] command failed', error);
              if (
                error instanceof TypeError ||
                (error instanceof MailOutboundError && error.disposition === 'permanent')
              ) {
                message.ack();
              } else {
                message.retry({ delaySeconds: 60 });
              }
            }
          }),
        );
        return;
      }
    }
  }
  async scheduled() {
    startNangoValidationForEnvironment(this.env, this.ctx);
    console.log('Running scheduled tasks...');

    await enqueueDueMailIngressWork(this.env);

    await enqueueDueMailOutboundWork(this.env);

    await wakeDueMailSnoozes(this.env);
  }
}
