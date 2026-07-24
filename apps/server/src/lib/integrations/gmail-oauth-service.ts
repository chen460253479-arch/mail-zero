import { fromByteArray } from 'base64-js';
import { z } from 'zod';

import {
  parsePublicConfig,
  toSafeIntegration,
  type SafeIntegration,
  type SystemIntegrationRecord,
  type SystemIntegrationRepository,
} from './repository';
import { decryptCredential, encryptCredential } from '../credentials/encryption';
import { createZeroOAuthSnapshot } from '../credentials/zero-oauth';

export type GmailOAuthRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GmailOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
};

export interface GmailOAuthGateway {
  createAuthorizationUrl(input: GmailOAuthRuntimeConfig & { state: string }): string;
  exchangeCode(config: GmailOAuthRuntimeConfig, code: string): Promise<GmailOAuthTokens>;
  resolveIdentity(
    config: GmailOAuthRuntimeConfig,
    tokens: GmailOAuthTokens,
  ): Promise<{ email: string; name: string; picture: string }>;
  revokeToken(config: GmailOAuthRuntimeConfig, token: string): Promise<void>;
}

type GmailMailbox = {
  email: string;
  name: string;
  picture: string;
  channelId: 'gmail';
  providerId: 'google';
  scope: string;
  expiresAt: Date;
};

type GmailAuthorization = {
  authSource: 'zero_oauth';
  credentialType: 'oauth2';
  encryptedCredentialSnapshot: string;
  accessTokenExpiresAt: Date;
  credentialFetchedAt: Date;
};

export interface GmailOAuthMailboxRepository {
  save(
    userId: string,
    mailbox: GmailMailbox,
    authorization: GmailAuthorization,
  ): Promise<{ id: string }>;
}

type GmailOAuthErrorCode =
  | 'GMAIL_OAUTH_AUTHORIZATION_FAILED'
  | 'GMAIL_OAUTH_NOT_CONFIGURED'
  | 'GMAIL_OAUTH_SECRET_REQUIRED'
  | 'GMAIL_OAUTH_SESSION_INVALID'
  | 'GMAIL_OAUTH_VALIDATION_FAILED'
  | 'INTEGRATION_IN_USE';

type GmailOAuthServiceDependencies = {
  repository: SystemIntegrationRepository;
  mailboxRepository: GmailOAuthMailboxRepository;
  gateway: GmailOAuthGateway;
  encryptionKey: string;
  redirectUris: {
    validation: string;
    mailbox: string;
  };
  now(): Date;
};

const runtimeConfigSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().url(),
});

const secretSchema = z.object({
  clientSecret: z.string().min(1),
});

const base64Url = (value: Uint8Array): string =>
  fromByteArray(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const hashState = async (state: string): Promise<string> =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))));

const createState = (): string => base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const readGmailOAuthRuntimeConfig = async (input: {
  repository: SystemIntegrationRepository;
  encryptionKey: string;
  redirectUri: string;
}): Promise<GmailOAuthRuntimeConfig> => {
  const record = await input.repository.get('gmail_zero_oauth');
  if (!record) throw new GmailOAuthError('GMAIL_OAUTH_NOT_CONFIGURED');
  const publicConfig = parsePublicConfig('gmail_zero_oauth', record.publicConfig);
  const secret = secretSchema.parse(
    await decryptCredential(record.encryptedSecret, input.encryptionKey),
  );
  return {
    clientId: publicConfig.clientId,
    clientSecret: secret.clientSecret,
    redirectUri: input.redirectUri,
  };
};

export class GmailOAuthError extends Error {
  constructor(public readonly code: GmailOAuthErrorCode) {
    super(code);
    this.name = 'GmailOAuthError';
  }
}

export class GmailOAuthService {
  constructor(private readonly dependencies: GmailOAuthServiceDependencies) {}

  async getSafeConfig(): Promise<
    | (SafeIntegration<'gmail_zero_oauth'> & {
        redirectUris: GmailOAuthServiceDependencies['redirectUris'];
      })
    | { configured: false; redirectUris: GmailOAuthServiceDependencies['redirectUris'] }
  > {
    const record = await this.dependencies.repository.get('gmail_zero_oauth');
    return record
      ? {
          ...toSafeIntegration({ ...record, integrationKey: 'gmail_zero_oauth' }),
          redirectUris: this.dependencies.redirectUris,
        }
      : { configured: false, redirectUris: this.dependencies.redirectUris };
  }

  async getRuntimeConfig(purpose: 'validation' | 'mailbox'): Promise<GmailOAuthRuntimeConfig> {
    return await readGmailOAuthRuntimeConfig({
      repository: this.dependencies.repository,
      encryptionKey: this.dependencies.encryptionKey,
      redirectUri: this.dependencies.redirectUris[purpose],
    });
  }

  async startValidation(input: {
    clientId: string;
    clientSecret?: string;
    adminId: string;
  }): Promise<{ sessionId: string; authorizationUrl: string }> {
    if ((await this.dependencies.repository.countZeroOAuthBindings('gmail')) > 0) {
      throw new GmailOAuthError('INTEGRATION_IN_USE');
    }

    const current = await this.dependencies.repository.get('gmail_zero_oauth');
    const clientSecret =
      input.clientSecret?.trim() || (current ? await this.readSecret(current) : undefined);
    if (!clientSecret) throw new GmailOAuthError('GMAIL_OAUTH_SECRET_REQUIRED');

    return await this.createSession(
      'validate_config',
      input.adminId,
      runtimeConfigSchema.parse({
        clientId: input.clientId,
        clientSecret,
        redirectUri: this.dependencies.redirectUris.validation,
      }),
    );
  }

  async completeValidation(input: { state: string; code: string; adminId: string }): Promise<void> {
    const session = await this.consumeSession('validate_config', input.adminId, input.state);
    if (!session) throw new GmailOAuthError('GMAIL_OAUTH_SESSION_INVALID');

    try {
      const config = runtimeConfigSchema.parse(
        await decryptCredential(session.encryptedPayload, this.dependencies.encryptionKey),
      );
      const tokens = await this.dependencies.gateway.exchangeCode(config, input.code);
      let identity: Awaited<ReturnType<GmailOAuthGateway['resolveIdentity']>>;
      try {
        identity = await this.dependencies.gateway.resolveIdentity(config, tokens);
      } finally {
        await Promise.allSettled(
          [tokens.accessToken, tokens.refreshToken]
            .filter(Boolean)
            .map((token) => this.dependencies.gateway.revokeToken(config, token)),
        );
      }
      if (!identity.email) throw new GmailOAuthError('GMAIL_OAUTH_VALIDATION_FAILED');

      await this.dependencies.repository.saveActive({
        integrationKey: 'gmail_zero_oauth',
        publicConfig: { clientId: config.clientId },
        encryptedSecret: await encryptCredential(
          { clientSecret: config.clientSecret },
          this.dependencies.encryptionKey,
        ),
        updatedBy: input.adminId,
        validatedAt: this.dependencies.now(),
      });
    } catch (error) {
      if (error instanceof GmailOAuthError) throw error;
      throw new GmailOAuthError('GMAIL_OAUTH_VALIDATION_FAILED');
    } finally {
      await this.dependencies.repository.deleteOAuthSession(session.id);
    }
  }

  async startMailboxAuthorization(
    userId: string,
  ): Promise<{ sessionId: string; authorizationUrl: string }> {
    return await this.createSession(
      'connect_mailbox',
      userId,
      await this.getRuntimeConfig('mailbox'),
    );
  }

  async completeMailboxAuthorization(input: {
    state: string;
    code: string;
    userId: string;
  }): Promise<{ id: string }> {
    const session = await this.consumeSession('connect_mailbox', input.userId, input.state);
    if (!session) throw new GmailOAuthError('GMAIL_OAUTH_SESSION_INVALID');

    try {
      const config = runtimeConfigSchema.parse(
        await decryptCredential(session.encryptedPayload, this.dependencies.encryptionKey),
      );
      const tokens = await this.dependencies.gateway.exchangeCode(config, input.code);
      const identity = await this.dependencies.gateway.resolveIdentity(config, tokens);
      if (!identity.email || !tokens.refreshToken) {
        throw new GmailOAuthError('GMAIL_OAUTH_AUTHORIZATION_FAILED');
      }

      return await this.dependencies.mailboxRepository.save(
        input.userId,
        {
          email: identity.email,
          name: identity.name || 'Unknown',
          picture: identity.picture || '',
          channelId: 'gmail',
          providerId: 'google',
          scope: tokens.scope,
          expiresAt: tokens.expiresAt,
        },
        {
          authSource: 'zero_oauth',
          credentialType: 'oauth2',
          encryptedCredentialSnapshot: await encryptCredential(
            createZeroOAuthSnapshot({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              scope: tokens.scope,
            }),
            this.dependencies.encryptionKey,
          ),
          accessTokenExpiresAt: tokens.expiresAt,
          credentialFetchedAt: this.dependencies.now(),
        },
      );
    } catch (error) {
      if (error instanceof GmailOAuthError) throw error;
      throw new GmailOAuthError('GMAIL_OAUTH_AUTHORIZATION_FAILED');
    } finally {
      await this.dependencies.repository.deleteOAuthSession(session.id);
    }
  }

  async delete(): Promise<void> {
    if ((await this.dependencies.repository.countZeroOAuthBindings('gmail')) > 0) {
      throw new GmailOAuthError('INTEGRATION_IN_USE');
    }
    await this.dependencies.repository.delete('gmail_zero_oauth');
  }

  private async createSession(
    purpose: 'validate_config' | 'connect_mailbox',
    createdBy: string,
    config: GmailOAuthRuntimeConfig,
  ): Promise<{ sessionId: string; authorizationUrl: string }> {
    const state = createState();
    const createdAt = this.dependencies.now();
    const sessionId = await this.dependencies.repository.createOAuthSession({
      integrationKey: 'gmail_zero_oauth',
      purpose,
      encryptedPayload: await encryptCredential(config, this.dependencies.encryptionKey),
      stateHash: await hashState(state),
      createdBy,
      expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
      createdAt,
    });
    return {
      sessionId,
      authorizationUrl: this.dependencies.gateway.createAuthorizationUrl({ ...config, state }),
    };
  }

  private async consumeSession(
    purpose: 'validate_config' | 'connect_mailbox',
    createdBy: string,
    state: string,
  ) {
    return await this.dependencies.repository.consumeOAuthSession({
      stateHash: await hashState(state),
      createdBy,
      purpose,
      now: this.dependencies.now(),
    });
  }

  private async readSecret(record: SystemIntegrationRecord): Promise<string | undefined> {
    const secret = secretSchema.parse(
      await decryptCredential(record.encryptedSecret, this.dependencies.encryptionKey),
    );
    return secret.clientSecret;
  }
}
