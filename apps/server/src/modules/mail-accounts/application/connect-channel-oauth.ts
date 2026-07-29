import { fromByteArray } from 'base64-js';
import { z } from 'zod';

import type {
  SafeIntegration,
  SystemIntegrationRecord,
  SystemIntegrationRepository,
} from '../../../integrations/core/repository';
import {
  decryptCredential,
  encryptCredential,
} from '../../../infrastructure/security/credential-encryption';
import type {
  IntegrationKey,
  IntegrationPublicConfigMap,
} from '../../../integrations/core/schemas';
import type { MailOAuthGateway, MailOAuthRuntimeConfig } from '../../../mail-channel/oauth/types';
import { parsePublicConfig, toSafeIntegration } from '../../../integrations/core/repository';
import type { MailChannelId } from '../../../mail-channel/contracts';
import { createZeroOAuthSnapshot } from '../credentials/zero-oauth';

export type ZeroOAuthChannelId = Extract<MailChannelId, 'outlook' | 'zoho_mail'>;
export type ZeroOAuthIntegrationKey = Extract<
  IntegrationKey,
  'outlook_zero_oauth' | 'zoho_mail_zero_oauth'
>;

type OAuthChannelSpec = {
  channelId: ZeroOAuthChannelId;
  providerKey: string;
  integrationKey: ZeroOAuthIntegrationKey;
};

type OAuthMailbox = {
  email: string;
  name: string;
  picture: string;
  channelId: ZeroOAuthChannelId;
  providerKey: string;
};

type OAuthAuthorization = {
  authSource: 'zero_oauth';
  credentialType: 'oauth2';
  encryptedCredentialSnapshot: string;
  accessTokenExpiresAt: Date;
  credentialFetchedAt: Date;
};

export interface ChannelOAuthMailboxRepository {
  save(
    userId: string,
    mailbox: OAuthMailbox,
    authorization: OAuthAuthorization,
  ): Promise<{ id: string }>;
}

export type ChannelOAuthErrorCode =
  | 'CHANNEL_OAUTH_AUTHORIZATION_FAILED'
  | 'CHANNEL_OAUTH_NOT_CONFIGURED'
  | 'CHANNEL_OAUTH_SECRET_REQUIRED'
  | 'CHANNEL_OAUTH_SESSION_INVALID'
  | 'CHANNEL_OAUTH_VALIDATION_FAILED'
  | 'INTEGRATION_IN_USE';

export class ChannelOAuthError extends Error {
  constructor(public readonly code: ChannelOAuthErrorCode) {
    super(code);
    this.name = 'ChannelOAuthError';
  }
}

type ChannelOAuthServiceDependencies = {
  spec: OAuthChannelSpec;
  repository: SystemIntegrationRepository;
  mailboxRepository: ChannelOAuthMailboxRepository;
  gateway: MailOAuthGateway;
  encryptionKey: string;
  redirectUris: {
    validation: string;
    mailbox: string;
  };
  loadProviderConfig(): Promise<Record<string, unknown>>;
  now(): Date;
};

const runtimeConfigSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().url(),
  providerConfig: z.record(z.string(), z.unknown()),
});

const secretSchema = z.object({
  clientSecret: z.string().min(1),
});

const base64Url = (value: Uint8Array): string =>
  fromByteArray(value).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');

const hashState = async (state: string): Promise<string> =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))));

const createState = (): string => base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const channelOAuthRedirectUris = (backendUrl: string, channelId: ZeroOAuthChannelId) => {
  const base = backendUrl.replace(/\/+$/u, '');
  return {
    validation: `${base}/api/integrations/${channelId}/validation/callback`,
    mailbox: `${base}/api/integrations/${channelId}/connect/callback`,
  };
};

export const readChannelOAuthRuntimeConfig = async (input: {
  repository: SystemIntegrationRepository;
  integrationKey: ZeroOAuthIntegrationKey;
  encryptionKey: string;
  redirectUri: string;
  providerConfig: Record<string, unknown>;
}): Promise<MailOAuthRuntimeConfig> => {
  const record = await input.repository.get(input.integrationKey);
  if (!record) throw new ChannelOAuthError('CHANNEL_OAUTH_NOT_CONFIGURED');
  const publicConfig = parsePublicConfig(input.integrationKey, record.publicConfig);
  const secret = secretSchema.parse(
    await decryptCredential(record.encryptedSecret, input.encryptionKey),
  );
  return runtimeConfigSchema.parse({
    clientId: publicConfig.clientId,
    clientSecret: secret.clientSecret,
    redirectUri: input.redirectUri,
    providerConfig: input.providerConfig,
  });
};

export class ChannelOAuthService {
  constructor(private readonly dependencies: ChannelOAuthServiceDependencies) {}

  async getSafeConfig(): Promise<
    | (SafeIntegration<ZeroOAuthIntegrationKey> & {
        redirectUris: ChannelOAuthServiceDependencies['redirectUris'];
      })
    | { configured: false; redirectUris: ChannelOAuthServiceDependencies['redirectUris'] }
  > {
    const record = await this.dependencies.repository.get(this.dependencies.spec.integrationKey);
    return record
      ? {
          ...toSafeIntegration({
            ...record,
            integrationKey: this.dependencies.spec.integrationKey,
          }),
          redirectUris: this.dependencies.redirectUris,
        }
      : { configured: false, redirectUris: this.dependencies.redirectUris };
  }

  async getRuntimeConfig(purpose: 'validation' | 'mailbox'): Promise<MailOAuthRuntimeConfig> {
    return await readChannelOAuthRuntimeConfig({
      repository: this.dependencies.repository,
      integrationKey: this.dependencies.spec.integrationKey,
      encryptionKey: this.dependencies.encryptionKey,
      redirectUri: this.dependencies.redirectUris[purpose],
      providerConfig: await this.dependencies.loadProviderConfig(),
    });
  }

  async startValidation(input: {
    clientId: string;
    clientSecret?: string;
    adminId: string;
  }): Promise<{ sessionId: string; authorizationUrl: string }> {
    if (
      (await this.dependencies.repository.countZeroOAuthBindings(
        this.dependencies.spec.channelId,
      )) > 0
    ) {
      throw new ChannelOAuthError('INTEGRATION_IN_USE');
    }
    const current = await this.dependencies.repository.get(this.dependencies.spec.integrationKey);
    const clientSecret =
      input.clientSecret?.trim() || (current ? await this.readSecret(current) : undefined);
    if (!clientSecret) throw new ChannelOAuthError('CHANNEL_OAUTH_SECRET_REQUIRED');
    return await this.createSession(
      'validate_config',
      input.adminId,
      runtimeConfigSchema.parse({
        clientId: input.clientId,
        clientSecret,
        redirectUri: this.dependencies.redirectUris.validation,
        providerConfig: await this.dependencies.loadProviderConfig(),
      }),
    );
  }

  async completeValidation(input: { state: string; code: string; adminId: string }): Promise<void> {
    const session = await this.consumeSession('validate_config', input.adminId, input.state);
    if (!session) throw new ChannelOAuthError('CHANNEL_OAUTH_SESSION_INVALID');
    try {
      const config = runtimeConfigSchema.parse(
        await decryptCredential(session.encryptedPayload, this.dependencies.encryptionKey),
      );
      const tokens = await this.dependencies.gateway.exchangeCode(config, input.code);
      try {
        const identity = await this.dependencies.gateway.resolveIdentity(config, tokens);
        if (!identity.email) throw new ChannelOAuthError('CHANNEL_OAUTH_VALIDATION_FAILED');
      } finally {
        await this.dependencies.gateway
          .revokeToken(config, tokens.refreshToken || tokens.accessToken)
          .catch(() => undefined);
      }
      await this.dependencies.repository.saveActive({
        integrationKey: this.dependencies.spec.integrationKey,
        publicConfig: {
          clientId: config.clientId,
        } as IntegrationPublicConfigMap[ZeroOAuthIntegrationKey],
        encryptedSecret: await encryptCredential(
          { clientSecret: config.clientSecret },
          this.dependencies.encryptionKey,
        ),
        updatedBy: input.adminId,
        validatedAt: this.dependencies.now(),
      });
    } catch (error) {
      if (error instanceof ChannelOAuthError) throw error;
      throw new ChannelOAuthError('CHANNEL_OAUTH_VALIDATION_FAILED');
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
    if (!session) throw new ChannelOAuthError('CHANNEL_OAUTH_SESSION_INVALID');
    try {
      const config = runtimeConfigSchema.parse(
        await decryptCredential(session.encryptedPayload, this.dependencies.encryptionKey),
      );
      const tokens = await this.dependencies.gateway.exchangeCode(config, input.code);
      const identity = await this.dependencies.gateway.resolveIdentity(config, tokens);
      if (!identity.email || !tokens.refreshToken) {
        throw new ChannelOAuthError('CHANNEL_OAUTH_AUTHORIZATION_FAILED');
      }
      return await this.dependencies.mailboxRepository.save(
        input.userId,
        {
          ...identity,
          channelId: this.dependencies.spec.channelId,
          providerKey: this.dependencies.spec.providerKey,
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
      if (error instanceof ChannelOAuthError) throw error;
      throw new ChannelOAuthError('CHANNEL_OAUTH_AUTHORIZATION_FAILED');
    } finally {
      await this.dependencies.repository.deleteOAuthSession(session.id);
    }
  }

  async getValidationStatus(
    sessionId: string,
    adminId: string,
  ): Promise<'pending' | 'complete' | 'expired'> {
    const session = await this.dependencies.repository.getOAuthSession({
      id: sessionId,
      integrationKey: this.dependencies.spec.integrationKey,
      createdBy: adminId,
      purpose: 'validate_config',
    });
    if (!session) return 'complete';
    if (session.expiresAt <= this.dependencies.now()) return 'expired';
    return session.consumedAt ? 'complete' : 'pending';
  }

  async delete(): Promise<void> {
    if (
      (await this.dependencies.repository.countZeroOAuthBindings(
        this.dependencies.spec.channelId,
      )) > 0
    ) {
      throw new ChannelOAuthError('INTEGRATION_IN_USE');
    }
    await this.dependencies.repository.delete(this.dependencies.spec.integrationKey);
  }

  private async createSession(
    purpose: 'validate_config' | 'connect_mailbox',
    createdBy: string,
    config: MailOAuthRuntimeConfig,
  ) {
    const state = createState();
    const createdAt = this.dependencies.now();
    const sessionId = await this.dependencies.repository.createOAuthSession({
      integrationKey: this.dependencies.spec.integrationKey,
      purpose,
      encryptedPayload: await encryptCredential(config, this.dependencies.encryptionKey),
      stateHash: await hashState(state),
      createdBy,
      expiresAt: new Date(createdAt.getTime() + 10 * 60_000),
      createdAt,
    });
    return {
      sessionId,
      authorizationUrl: this.dependencies.gateway.createAuthorizationUrl({
        ...config,
        state,
      }),
    };
  }

  private async consumeSession(
    purpose: 'validate_config' | 'connect_mailbox',
    createdBy: string,
    state: string,
  ) {
    return await this.dependencies.repository.consumeOAuthSession({
      stateHash: await hashState(state),
      integrationKey: this.dependencies.spec.integrationKey,
      createdBy,
      purpose,
      now: this.dependencies.now(),
    });
  }

  private async readSecret(record: SystemIntegrationRecord): Promise<string | undefined> {
    return secretSchema.parse(
      await decryptCredential(record.encryptedSecret, this.dependencies.encryptionKey),
    ).clientSecret;
  }
}
