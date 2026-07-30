import { createAuthMiddleware, jwt, bearer, username } from 'better-auth/plugins';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';

import { createPostgresExternalAccessRepository } from '../modules/external-integration/postgres/repository';
import { createMailboxLifecycleForDatabase } from '../modules/mail-accounts/runtime/lifecycle-environment';
import { consumeLaunchCode } from '../modules/external-integration/application/consume-launch-code';
import { managedLaunch } from '../modules/external-integration/auth/managed-launch';
import type { UserWorkspaceService } from '../modules/user-workspace/service';
import type { MailInboundRuntimeResources } from '../runtime/mail/inbound';
import { getBrowserTimezone, isValidTimezone } from './timezones';
import type { RuntimeConfig } from '../runtime/node/config';
import { defaultUserSettings } from './schemas';
import { connection } from '../db/schema';
import type { DB } from '../db';

export type AuthRuntimeDependencies = {
  db: DB;
  config: RuntimeConfig;
  mail: MailInboundRuntimeResources;
  userWorkspace: UserWorkspaceService;
  email: {
    send(input: { from: string; to: string; subject: string; html: string }): Promise<unknown>;
  };
};

const createAuthConfig = (dependencies: AuthRuntimeDependencies) =>
  ({
    database: drizzleAdapter(dependencies.db, { provider: 'pg' }),
    advanced: {
      ipAddress: {
        disableIpTracking: true,
      },
      cookiePrefix:
        dependencies.config.nodeEnv === 'development' ? 'better-auth-dev' : 'better-auth',
      crossSubDomainCookies: {
        enabled: true,
        domain: dependencies.config.cookieDomain,
      },
    },
    baseURL: dependencies.config.publicBackendUrl,
    trustedOrigins: dependencies.config.betterAuthTrustedOrigins,
    session: {
      additionalFields: {
        authMethod: {
          type: 'string',
          required: false,
          defaultValue: 'password',
          input: false,
        },
      },
      cookieCache: {
        enabled: false,
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24 * 3,
    },
    onAPIError: {
      onError: (error) => {
        console.error('API Error', error);
      },
      errorURL: `${dependencies.config.publicAppUrl}/login`,
      throw: true,
    },
  }) satisfies BetterAuthOptions;

export const createAuth = (dependencies: AuthRuntimeDependencies) =>
  betterAuth({
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 64,
        usernameNormalization: false,
      }),
      managedLaunch({
        consumeLaunchCode: async (input) =>
          await consumeLaunchCode(input, {
            repository: createPostgresExternalAccessRepository(dependencies.db),
            clock: { now: () => new Date() },
          }),
        publicAppUrl: dependencies.config.publicAppUrl,
      }),
      jwt(),
      bearer(),
    ],
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false,
        },
        mustChangePassword: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false,
        },
      },
      deleteUser: {
        enabled: true,
        async sendDeleteAccountVerification(data) {
          const verificationUrl = data.url;
          await dependencies.email.send({
            from: '0.email <no-reply@0.email>',
            to: data.user.email,
            subject: 'Delete your 0.email account',
            html: `
            <h2>Delete Your 0.email Account</h2>
            <p>Click the link below to delete your account:</p>
            <a href="${verificationUrl}">${verificationUrl}</a>
          `,
          });
        },
        beforeDelete: async (user, request) => {
          if (!request) throw new APIError('BAD_REQUEST', { message: 'Request object is missing' });
          const connections = await dependencies.db
            .select({ id: connection.id })
            .from(connection)
            .where(eq(connection.userId, user.id));
          const lifecycle = createMailboxLifecycleForDatabase(dependencies.db, dependencies.mail);
          for (const mailbox of connections) {
            await lifecycle.disconnect({
              userId: user.id,
              connectionId: mailbox.id,
              deleteLocalData: true,
            });
          }
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        await dependencies.email.send({
          from: '0.email <onboarding@0.email>',
          to: user.email,
          subject: 'Reset your password',
          html: `
            <h2>Reset Your Password</h2>
            <p>Click the link below to reset your password:</p>
            <a href="${url}">${url}</a>
            <p>If you didn't request this, you can safely ignore this email.</p>
          `,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, token }) => {
        const verificationUrl = `${dependencies.config.publicAppUrl}/api/auth/verify-email?token=${token}&callbackURL=/settings/connections`;
        await dependencies.email.send({
          from: '0.email <onboarding@0.email>',
          to: user.email,
          subject: 'Verify your 0.email account',
          html: `
            <h2>Verify Your 0.email Account</h2>
            <p>Click the link below to verify your email:</p>
            <a href="${verificationUrl}">${verificationUrl}</a>
          `,
        });
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith('/sign-up')) return;
        const newSession = ctx.context.newSession;
        if (!newSession) return;
        const workspace = dependencies.userWorkspace.forUser(newSession.user.id);
        if (await workspace.findUserSettings()) return;
        const headerTimezone = ctx.headers?.get('x-vercel-ip-timezone');
        const timezone =
          headerTimezone && isValidTimezone(headerTimezone) ? headerTimezone : getBrowserTimezone();
        await workspace.insertUserSettings({
          ...defaultUserSettings,
          timezone,
        });
      }),
    },
    ...createAuthConfig(dependencies),
  });

export const createSimpleAuth = (dependencies: AuthRuntimeDependencies) =>
  betterAuth(createAuthConfig(dependencies));

export type Auth = ReturnType<typeof createAuth>;
export type SimpleAuth = ReturnType<typeof createSimpleAuth>;
