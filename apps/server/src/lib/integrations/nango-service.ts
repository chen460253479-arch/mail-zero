import {
  parsePublicConfig,
  toSafeIntegration,
  type SafeIntegration,
  type SystemIntegrationRepository,
} from './repository';
import { decryptCredential, encryptCredential } from '../credentials/encryption';
import { gmailNangoProviders } from '../mail-channel/gmail-metadata';
import type { NangoIntegration } from '../nango/types';
import type { NangoClient } from '../nango/client';

type NangoClientLike = Pick<NangoClient, 'listIntegrations' | 'listConnections' | 'getConnection'>;

type NangoIntegrationErrorCode =
  | 'INTEGRATION_IN_USE'
  | 'NANGO_INTEGRATION_UNAVAILABLE'
  | 'NANGO_NOT_CONFIGURED'
  | 'NANGO_PERMISSION_VALIDATION_FAILED'
  | 'NANGO_SECRET_REQUIRED'
  | 'NANGO_TEST_CONNECTION_REQUIRED';

type NangoSecret = {
  secretKey: string;
};

type NangoRuntimeConfig = {
  baseUrl: string;
  secretKey: string;
};

type NangoIntegrationServiceDependencies = {
  repository: SystemIntegrationRepository;
  encryptionKey: string;
  createClient(config: NangoRuntimeConfig): NangoClientLike;
  now(): Date;
};

const normalizeBaseUrl = (value: string): string => new URL(value).toString().replace(/\/+$/, '');

const uniqueReferences = (
  references: Array<{ integrationId: string; connectionId: string }>,
): Array<{ integrationId: string; connectionId: string }> => [
  ...new Map(
    references.map((reference) => [
      `${reference.integrationId}\u0000${reference.connectionId}`,
      reference,
    ]),
  ).values(),
];

const mapWithConcurrency = async <T>(
  values: T[],
  concurrency: number,
  run: (value: T) => Promise<void>,
): Promise<void> => {
  let index = 0;
  const worker = async () => {
    while (index < values.length) {
      const value = values[index++];
      if (value !== undefined) await run(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
};

export class NangoIntegrationError extends Error {
  constructor(public readonly code: NangoIntegrationErrorCode) {
    super(code);
    this.name = 'NangoIntegrationError';
  }
}

export class NangoIntegrationService {
  constructor(private readonly dependencies: NangoIntegrationServiceDependencies) {}

  async getSafeConfig(): Promise<SafeIntegration<'nango'> | { configured: false }> {
    const record = await this.dependencies.repository.get('nango');
    return record
      ? toSafeIntegration({ ...record, integrationKey: 'nango' })
      : { configured: false };
  }

  async getRuntimeConfig(): Promise<NangoRuntimeConfig> {
    const record = await this.dependencies.repository.get('nango');
    if (!record) throw new NangoIntegrationError('NANGO_NOT_CONFIGURED');
    const publicConfig = parsePublicConfig('nango', record.publicConfig);
    const secret = await decryptCredential<NangoSecret>(
      record.encryptedSecret,
      this.dependencies.encryptionKey,
    );
    if (!secret.secretKey) throw new NangoIntegrationError('NANGO_NOT_CONFIGURED');
    return { baseUrl: publicConfig.baseUrl, secretKey: secret.secretKey };
  }

  async validateAndSave(input: {
    baseUrl: string;
    secretKey?: string;
    updatedBy: string;
  }): Promise<SafeIntegration<'nango'>> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const [current, references] = await Promise.all([
      this.dependencies.repository.get('nango'),
      this.dependencies.repository.listNangoReferences(),
    ]);

    if (current && references.length > 0) {
      const currentConfig = parsePublicConfig('nango', current.publicConfig);
      if (normalizeBaseUrl(currentConfig.baseUrl) !== baseUrl) {
        throw new NangoIntegrationError('INTEGRATION_IN_USE');
      }
    }

    const secretKey = input.secretKey?.trim() || (await this.readExistingSecret(current));
    if (!secretKey) throw new NangoIntegrationError('NANGO_SECRET_REQUIRED');

    const client = this.dependencies.createClient({ baseUrl, secretKey });
    await this.validatePermissions(client, references);

    const validatedAt = this.dependencies.now();
    const encryptedSecret = await encryptCredential(
      { secretKey } satisfies NangoSecret,
      this.dependencies.encryptionKey,
    );
    await this.dependencies.repository.saveActive({
      integrationKey: 'nango',
      publicConfig: { baseUrl },
      encryptedSecret,
      updatedBy: input.updatedBy,
      validatedAt,
    });

    return {
      configured: true,
      key: 'nango',
      publicConfig: { baseUrl },
      secretConfigured: true,
      status: 'active',
      validatedAt,
    };
  }

  async listGmailIntegrations(): Promise<NangoIntegration[]> {
    const client = this.dependencies.createClient(await this.getRuntimeConfig());
    try {
      return (await client.listIntegrations()).filter(({ provider }) =>
        gmailNangoProviders.includes(provider),
      );
    } catch {
      throw new NangoIntegrationError('NANGO_PERMISSION_VALIDATION_FAILED');
    }
  }

  async setGmailMapping(integrationId: string): Promise<void> {
    const current = await this.dependencies.repository.getMapping('gmail', 'nango');
    if (current?.externalIntegrationId === integrationId) return;
    if (
      current &&
      (await this.dependencies.repository.countNangoBindings(current.externalIntegrationId)) > 0
    ) {
      throw new NangoIntegrationError('INTEGRATION_IN_USE');
    }

    const integrations = await this.listGmailIntegrations();
    if (!integrations.some(({ unique_key }) => unique_key === integrationId)) {
      throw new NangoIntegrationError('NANGO_INTEGRATION_UNAVAILABLE');
    }
    await this.dependencies.repository.setMapping('gmail', 'nango', integrationId);
  }

  async delete(): Promise<void> {
    if ((await this.dependencies.repository.countNangoBindings()) > 0) {
      throw new NangoIntegrationError('INTEGRATION_IN_USE');
    }
    await this.dependencies.repository.deleteNangoConfiguration();
  }

  private async readExistingSecret(
    current: Awaited<ReturnType<SystemIntegrationRepository['get']>>,
  ): Promise<string | undefined> {
    if (!current) return undefined;
    const secret = await decryptCredential<NangoSecret>(
      current.encryptedSecret,
      this.dependencies.encryptionKey,
    );
    return secret.secretKey;
  }

  private async validatePermissions(
    client: NangoClientLike,
    references: Array<{ integrationId: string; connectionId: string }>,
  ): Promise<void> {
    try {
      const integrations = await client.listIntegrations();
      if (references.length > 0) {
        await mapWithConcurrency(uniqueReferences(references), 5, async (reference) => {
          await client.getConnection(reference.connectionId, reference.integrationId);
        });
        return;
      }

      for (const integration of integrations) {
        const [connection] = await client.listConnections(integration.unique_key);
        if (!connection) continue;
        await client.getConnection(connection.connection_id, integration.unique_key);
        return;
      }
    } catch {
      throw new NangoIntegrationError('NANGO_PERMISSION_VALIDATION_FAILED');
    }

    throw new NangoIntegrationError('NANGO_TEST_CONNECTION_REQUIRED');
  }
}
