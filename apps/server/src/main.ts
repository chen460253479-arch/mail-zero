import {
  enqueueDueMailIngressWork,
  handleGmailWebhookForEnvironment,
  runMailIngressCommand,
} from './runtime/mail/gmail-inbound';
import {
  account,
  note,
  session,
  user,
  userHotkeys,
  userSettings,
  emailTemplate,
} from './db/schema';
import { enqueueDueMailOutboundWork, runMailOutboundCommand } from './runtime/mail/outbound';
import { MailOutboundError, parseMailOutboundCommand } from './modules/mail-outbound';
import { parseMailIngressCommand } from './modules/mail-sync/application/commands';
import { WorkerEntrypoint, DurableObject, RpcTarget } from 'cloudflare:workers';
import { wakeDueMailSnoozes } from './modules/mail-snooze/runtime/environment';
import { registerMailBlobRoutes } from './modules/mail-api';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import { MailSyncError } from './modules/mail-sync';
import { getZeroDB } from './lib/server-utils';

import { ensureConfiguredAdmin } from './lib/admin-provisioning';
import { integrationOAuthRouter } from './routes/integrations';
import { contextStorage } from 'hono/context-storage';
import { defaultUserSettings } from './lib/schemas';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { trpcServer } from '@hono/trpc-server';
import { publicRouter } from './routes/auth';
import { env, type ZeroEnv } from './env';
import type { HonoContext } from './ctx';
import { createDb, type DB } from './db';
import { createAuth } from './lib/auth';
import { appRouter } from './trpc';
import { cors } from 'hono/cors';
import { Hono } from 'hono';

export class DbRpcDO extends RpcTarget {
  constructor(
    private mainDo: ZeroDB,
    private userId: string,
  ) {
    super();
  }

  async findUser(): Promise<typeof user.$inferSelect | undefined> {
    return await this.mainDo.findUser(this.userId);
  }

  async updateUser(data: Partial<typeof user.$inferInsert>) {
    return await this.mainDo.updateUser(this.userId, data);
  }

  async findManyNotesByThreadId(
    connectionId: string,
    threadId: string,
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.mainDo.findManyNotesByThreadId(this.userId, connectionId, threadId);
  }

  async createNote(
    connectionId: string,
    payload: Omit<typeof note.$inferInsert, 'userId' | 'connectionId'>,
  ) {
    return await this.mainDo.createNote(
      this.userId,
      connectionId,
      payload as typeof note.$inferInsert,
    );
  }

  async updateNote(
    connectionId: string,
    noteId: string,
    payload: Partial<typeof note.$inferInsert>,
  ) {
    return await this.mainDo.updateNote(this.userId, connectionId, noteId, payload);
  }

  async updateManyNotes(
    connectionId: string,
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean> {
    return await this.mainDo.updateManyNotes(this.userId, connectionId, notes);
  }

  async findManyNotesByIds(
    connectionId: string,
    noteIds: string[],
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.mainDo.findManyNotesByIds(this.userId, connectionId, noteIds);
  }

  async deleteNote(connectionId: string, noteId: string) {
    return await this.mainDo.deleteNote(this.userId, connectionId, noteId);
  }

  async findNoteById(
    connectionId: string,
    noteId: string,
  ): Promise<typeof note.$inferSelect | undefined> {
    return await this.mainDo.findNoteById(this.userId, connectionId, noteId);
  }

  async findHighestNoteOrder(connectionId: string): Promise<{ order: number } | undefined> {
    return await this.mainDo.findHighestNoteOrder(this.userId, connectionId);
  }

  async deleteUser() {
    return await this.mainDo.deleteUser(this.userId);
  }

  async findUserSettings(): Promise<typeof userSettings.$inferSelect | undefined> {
    return await this.mainDo.findUserSettings(this.userId);
  }

  async findUserHotkeys(): Promise<(typeof userHotkeys.$inferSelect)[]> {
    return await this.mainDo.findUserHotkeys(this.userId);
  }

  async insertUserHotkeys(shortcuts: (typeof userHotkeys.$inferInsert)[]) {
    return await this.mainDo.insertUserHotkeys(this.userId, shortcuts);
  }

  async insertUserSettings(settings: typeof defaultUserSettings) {
    return await this.mainDo.insertUserSettings(this.userId, settings);
  }

  async updateUserSettings(settings: typeof defaultUserSettings) {
    return await this.mainDo.updateUserSettings(this.userId, settings);
  }

  async listEmailTemplates(): Promise<(typeof emailTemplate.$inferSelect)[]> {
    return await this.mainDo.findManyEmailTemplates(this.userId);
  }

  async createEmailTemplate(payload: Omit<typeof emailTemplate.$inferInsert, 'userId'>) {
    return await this.mainDo.createEmailTemplate(this.userId, payload);
  }

  async deleteEmailTemplate(templateId: string) {
    return await this.mainDo.deleteEmailTemplate(this.userId, templateId);
  }

  async updateEmailTemplate(templateId: string, data: Partial<typeof emailTemplate.$inferInsert>) {
    return await this.mainDo.updateEmailTemplate(this.userId, templateId, data);
  }
}

class ZeroDB extends DurableObject<ZeroEnv> {
  db: DB = createDb(this.env.HYPERDRIVE.connectionString).db;

  async setMetaData(userId: string) {
    return new DbRpcDO(this, userId);
  }

  async findUser(userId: string): Promise<typeof user.$inferSelect | undefined> {
    return await this.db.query.user.findFirst({
      where: eq(user.id, userId),
    });
  }

  async updateUser(userId: string, data: Partial<typeof user.$inferInsert>) {
    return await this.db.update(user).set(data).where(eq(user.id, userId));
  }

  async findManyNotesByThreadId(
    userId: string,
    connectionId: string,
    threadId: string,
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.db.query.note.findMany({
      where: and(
        eq(note.userId, userId),
        eq(note.connectionId, connectionId),
        eq(note.threadId, threadId),
      ),
      orderBy: [desc(note.isPinned), asc(note.order), desc(note.createdAt)],
    });
  }

  async createNote(userId: string, connectionId: string, payload: typeof note.$inferInsert) {
    return await this.db
      .insert(note)
      .values({
        ...payload,
        userId,
        connectionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  }

  async updateNote(
    userId: string,
    connectionId: string,
    noteId: string,
    payload: Partial<typeof note.$inferInsert>,
  ): Promise<typeof note.$inferSelect | undefined> {
    const [updated] = await this.db
      .update(note)
      .set({
        ...payload,
        updatedAt: new Date(),
      })
      .where(and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)))
      .returning();
    return updated;
  }

  async updateManyNotes(
    userId: string,
    connectionId: string,
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      for (const n of notes) {
        const updateData: Record<string, unknown> = {
          order: n.order,
          updatedAt: new Date(),
        };

        if (n.isPinned !== undefined) {
          updateData.isPinned = n.isPinned;
        }
        await tx
          .update(note)
          .set(updateData)
          .where(
            and(eq(note.id, n.id), eq(note.userId, userId), eq(note.connectionId, connectionId)),
          );
      }
      return true;
    });
  }

  async findManyNotesByIds(
    userId: string,
    connectionId: string,
    noteIds: string[],
  ): Promise<(typeof note.$inferSelect)[]> {
    return await this.db.query.note.findMany({
      where: and(
        eq(note.userId, userId),
        eq(note.connectionId, connectionId),
        inArray(note.id, noteIds),
      ),
    });
  }

  async deleteNote(userId: string, connectionId: string, noteId: string) {
    return await this.db
      .delete(note)
      .where(
        and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)),
      );
  }

  async findNoteById(
    userId: string,
    connectionId: string,
    noteId: string,
  ): Promise<typeof note.$inferSelect | undefined> {
    return await this.db.query.note.findFirst({
      where: and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)),
    });
  }

  async findHighestNoteOrder(
    userId: string,
    connectionId: string,
  ): Promise<{ order: number } | undefined> {
    return await this.db.query.note.findFirst({
      where: and(eq(note.userId, userId), eq(note.connectionId, connectionId)),
      orderBy: desc(note.order),
      columns: { order: true },
    });
  }

  async deleteUser(userId: string) {
    return await this.db.transaction(async (tx) => {
      await tx.delete(account).where(eq(account.userId, userId));
      await tx.delete(session).where(eq(session.userId, userId));
      await tx.delete(userSettings).where(eq(userSettings.userId, userId));
      await tx.delete(user).where(eq(user.id, userId));
      await tx.delete(userHotkeys).where(eq(userHotkeys.userId, userId));
    });
  }

  async findUserSettings(userId: string): Promise<typeof userSettings.$inferSelect | undefined> {
    return await this.db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });
  }

  async findUserHotkeys(userId: string): Promise<(typeof userHotkeys.$inferSelect)[]> {
    return await this.db.query.userHotkeys.findMany({
      where: eq(userHotkeys.userId, userId),
    });
  }

  async insertUserHotkeys(userId: string, shortcuts: (typeof userHotkeys.$inferInsert)[]) {
    return await this.db
      .insert(userHotkeys)
      .values({
        userId,
        shortcuts,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userHotkeys.userId,
        set: {
          shortcuts,
          updatedAt: new Date(),
        },
      });
  }

  async insertUserSettings(userId: string, settings: typeof defaultUserSettings) {
    return await this.db.insert(userSettings).values({
      id: crypto.randomUUID(),
      userId,
      settings,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async updateUserSettings(userId: string, settings: typeof defaultUserSettings) {
    return await this.db
      .insert(userSettings)
      .values({
        id: crypto.randomUUID(),
        userId,
        settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          settings,
          updatedAt: new Date(),
        },
      });
  }

  async findManyEmailTemplates(userId: string): Promise<(typeof emailTemplate.$inferSelect)[]> {
    return await this.db.query.emailTemplate.findMany({
      where: eq(emailTemplate.userId, userId),
      orderBy: desc(emailTemplate.updatedAt),
    });
  }

  async createEmailTemplate(
    userId: string,
    payload: Omit<typeof emailTemplate.$inferInsert, 'userId'>,
  ) {
    return await this.db
      .insert(emailTemplate)
      .values({
        ...payload,
        userId,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  }

  async deleteEmailTemplate(userId: string, templateId: string) {
    return await this.db
      .delete(emailTemplate)
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)));
  }

  async updateEmailTemplate(
    userId: string,
    templateId: string,
    data: Partial<typeof emailTemplate.$inferInsert>,
  ) {
    return await this.db
      .update(emailTemplate)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)))
      .returning();
  }
}

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
            const db = await getZeroDB(userId);
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
  .post('/api/mail/channels/gmail/push', (c) => handleGmailWebhookForEnvironment(c.env, c.req.raw));
const handler = {
  async fetch(request: Request, env: ZeroEnv, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};

export default class Entry extends WorkerEntrypoint<ZeroEnv> {
  async fetch(request: Request): Promise<Response> {
    return handler.fetch(request, this.env, this.ctx);
  }
  async queue(batch: MessageBatch<unknown>) {
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
    console.log('Running scheduled tasks...');

    await enqueueDueMailIngressWork(this.env);

    await enqueueDueMailOutboundWork(this.env);

    await wakeDueMailSnoozes(this.env);
  }
}

export { ZeroDB };
