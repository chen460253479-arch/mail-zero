import {
  AIWritingAssistantEmail,
  AutoLabelingEmail,
  CategoriesEmail,
  ShortcutsEmail,
  SuperSearchEmail,
  WelcomeEmail,
} from './react-emails/email-sequences';
import { getMailChannel, providerIdToChannelId } from './mail-channel/registry';
import { type Account, betterAuth, type BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware, jwt, bearer, mcp } from 'better-auth/plugins';
import { resolveConnectionCredential } from './credentials/resolve';
import { createZeroOAuthSnapshot } from './credentials/zero-oauth';
import { getBrowserTimezone, isValidTimezone } from './timezones';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { encryptCredential } from './credentials/encryption';
import { getZeroDB, resetConnection } from './server-utils';
import { getSocialProviders } from './auth-providers';
import { dubAnalytics } from '@dub/better-auth';
import { defaultUserSettings } from './schemas';
import { disableBrainFunction } from './brain';
import { APIError } from 'better-auth/api';
import { redis, resend } from './services';
import { type EProviders } from '../types';
import { createDb } from '../db';
import { Effect } from 'effect';
import { env } from '../env';
import { Dub } from 'dub';

const scheduleCampaign = (userInfo: { address: string; name: string }) =>
  Effect.gen(function* () {
    const name = userInfo.name || 'there';
    const resendService = resend();

    const sendEmail = (subject: string, react: unknown, scheduledAt?: string) =>
      Effect.promise(() =>
        resendService.emails
          .send({
            from: '0.email <onboarding@0.email>',
            to: userInfo.address,
            subject,
            react: react as any,
            ...(scheduledAt && { scheduledAt }),
          })
          .then(() => void 0),
      );

    const emails = [
      {
        subject: 'Welcome to 0.email',
        react: WelcomeEmail({ name }),
        scheduledAt: undefined,
      },
      {
        subject: 'Auto-labeling is here 🎉📥',
        react: AutoLabelingEmail({ name }),
        scheduledAt: 'in 2 days',
      },
      {
        subject: 'AI Writing Assistant is here 🤖💬',
        react: AIWritingAssistantEmail({ name }),
        scheduledAt: 'in 3 days',
      },
      {
        subject: 'Shortcuts are here 🔧🚀',
        react: ShortcutsEmail({ name }),
        scheduledAt: 'in 4 days',
      },
      {
        subject: 'Categories are here 📂🔍',
        react: CategoriesEmail({ name }),
        scheduledAt: 'in 5 days',
      },
      {
        subject: 'Super Search is here 🔍🚀',
        react: SuperSearchEmail({ name }),
        scheduledAt: 'in 6 days',
      },
    ];

    yield* Effect.all(
      emails.map((email) => sendEmail(email.subject, email.react, email.scheduledAt)),
      { concurrency: 'unbounded' },
    );
  });

const connectionHandlerHook = async (account: Account) => {
  if (account.providerId === 'credential') return;

  if (!account.accessToken || !account.refreshToken) {
    console.error('Missing Access/Refresh Tokens', { account });
    throw new APIError('EXPECTATION_FAILED', {
      message: 'Missing Access/Refresh Tokens, contact us on Discord for support',
    });
  }

  const channelId = providerIdToChannelId(account.providerId);
  const channel = getMailChannel(channelId);
  const managerConfig = {
    auth: {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      userId: account.userId,
      email: '',
    },
  };

  const identity = await channel.resolveIdentity(managerConfig).catch(async () => {
    if (account.accessToken) {
      await channel.revoke(managerConfig, account.accessToken);
      await resetConnection(account.id);
    }
    throw new Response(null, { status: 301, headers: { Location: '/' } });
  });

  if (!identity.email) {
    try {
      await Promise.allSettled(
        [account.accessToken, account.refreshToken]
          .filter(Boolean)
          .map((token) => channel.revoke(managerConfig, token as string)),
      );
      await resetConnection(account.id);
    } catch (error) {
      console.error('Failed to revoke tokens:', error);
    }
    throw new Response(null, { status: 303, headers: { Location: '/' } });
  }

  const scope = channel.getScope(managerConfig);
  const expiresAt = account.accessTokenExpiresAt ?? new Date(Date.now() + 3_600_000);
  const encryptedCredentialSnapshot = await encryptCredential(
    createZeroOAuthSnapshot({
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      scope,
    }),
    env.CREDENTIAL_ENCRYPTION_KEY,
  );

  const db = await getZeroDB(account.userId);
  const result = await db.createMailboxWithAuthorization(
    {
      email: identity.email,
      name: identity.name || 'Unknown',
      picture: identity.picture || '',
      channelId,
      providerId: account.providerId as EProviders,
      scope,
      expiresAt,
    },
    {
      authSource: 'zero_oauth',
      credentialType: 'oauth2',
      encryptedCredentialSnapshot,
      accessTokenExpiresAt: expiresAt,
      credentialFetchedAt: new Date(),
    },
  );

  if (env.NODE_ENV === 'production') {
    await Effect.runPromise(
      scheduleCampaign({ address: identity.email, name: identity.name || 'there' }),
    );
  }

  if (env.GOOGLE_S_ACCOUNT && env.GOOGLE_S_ACCOUNT !== '{}') {
    await env.subscribe_queue.send({
      connectionId: result.id,
      providerId: account.providerId,
    });
  }
};

export const createAuth = () => {
  const dub = new Dub();

  return betterAuth({
    plugins: [
      dubAnalytics({
        dubClient: dub,
      }),
      mcp({
        loginPage: env.VITE_PUBLIC_APP_URL + '/login',
      }),
      jwt(),
      bearer(),
    ],
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'admin',
          input: false,
        },
      },
      deleteUser: {
        enabled: true,
        async sendDeleteAccountVerification(data) {
          const verificationUrl = data.url;

          await resend().emails.send({
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
          const db = await getZeroDB(user.id);
          const connections = await db.findManyConnections();

          const revokedAccounts = (
            await Promise.allSettled(
              connections.map(async (connection) => {
                await disableBrainFunction({
                  id: connection.id,
                  providerId: connection.providerId as EProviders,
                });
                const record = await db.findConnectionWithAuthorization(connection.id);
                if (!record) return false;
                if (record.authorization?.authSource === 'nango') return true;
                const credential = await resolveConnectionCredential(
                  record,
                  env.CREDENTIAL_ENCRYPTION_KEY,
                );
                if (credential.type !== 'oauth2') return false;
                const channel = getMailChannel(connection.channelId);
                const managerConfig = {
                  auth: {
                    accessToken: credential.accessToken,
                    refreshToken: credential.refreshToken ?? '',
                    userId: user.id,
                    email: connection.email,
                  },
                };
                return await channel.revoke(
                  managerConfig,
                  credential.refreshToken ?? credential.accessToken,
                );
              }),
            )
          ).map((result) => {
            if (result.status === 'fulfilled') {
              return result.value;
            }
            return false;
          });

          if (!revokedAccounts.every((value) => !!value)) {
            console.log('Failed to revoke some accounts');
          }

          await db.deleteUser();
        },
      },
    },
    databaseHooks: {
      account: {
        create: {
          after: connectionHandlerHook,
        },
        update: {
          after: connectionHandlerHook,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        await resend().emails.send({
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
        const verificationUrl = `${env.VITE_PUBLIC_APP_URL}/api/auth/verify-email?token=${token}&callbackURL=/settings/connections`;

        await resend().emails.send({
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
        // all hooks that run on sign-up routes
        if (ctx.path.startsWith('/sign-up')) {
          // only true if this request is from a new user
          const newSession = ctx.context.newSession;
          if (newSession) {
            // Check if user already has settings
            const db = await getZeroDB(newSession.user.id);
            const existingSettings = await db.findUserSettings();

            if (!existingSettings) {
              // get timezone from vercel's header
              const headerTimezone = ctx.headers?.get('x-vercel-ip-timezone');
              // validate timezone from header or fallback to browser timezone
              const timezone =
                headerTimezone && isValidTimezone(headerTimezone)
                  ? headerTimezone
                  : getBrowserTimezone();
              // write default settings against the user
              await db.insertUserSettings({
                ...defaultUserSettings,
                timezone,
              });
            }
          }
        }
      }),
    },
    ...createAuthConfig(),
  });
};

const createAuthConfig = () => {
  const cache = redis();
  const { db } = createDb(env.HYPERDRIVE.connectionString);
  return {
    database: drizzleAdapter(db, { provider: 'pg' }),
    secondaryStorage: {
      get: async (key: string) => {
        const value = await cache.get(key);
        return typeof value === 'string' ? value : value ? JSON.stringify(value) : null;
      },
      set: async (key: string, value: string, ttl?: number) => {
        if (ttl) await cache.set(key, value, { ex: ttl });
        else await cache.set(key, value);
      },
      delete: async (key: string) => {
        await cache.del(key);
      },
    },
    advanced: {
      ipAddress: {
        disableIpTracking: true,
      },
      cookiePrefix: env.NODE_ENV === 'development' ? 'better-auth-dev' : 'better-auth',
      crossSubDomainCookies: {
        enabled: true,
        domain: env.COOKIE_DOMAIN,
      },
    },
    baseURL: env.VITE_PUBLIC_BACKEND_URL,
    trustedOrigins: [
      'https://app.0.email',
      'https://sapi.0.email',
      'https://staging.0.email',
      'https://0.email',
      'http://localhost:3000',
    ],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 60 * 24 * 30, // 30 days
      },
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24 * 3, // 1 day (every 1 day the session expiration is updated)
    },
    socialProviders: getSocialProviders(env as unknown as Record<string, string>),
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
        trustedProviders: ['google', 'microsoft'],
      },
    },
    onAPIError: {
      onError: (error) => {
        console.error('API Error', error);
      },
      errorURL: `${env.VITE_PUBLIC_APP_URL}/login`,
      throw: true,
    },
  } satisfies BetterAuthOptions;
};

export const createSimpleAuth = () => {
  return betterAuth(createAuthConfig());
};

export type Auth = ReturnType<typeof createAuth>;
export type SimpleAuth = ReturnType<typeof createSimpleAuth>;
