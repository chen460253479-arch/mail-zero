import {
  parsePublicConfig,
  toSafeIntegration,
  type SafeIntegration,
  type SystemIntegrationRepository,
} from '../../integrations/core/repository';
import {
  decryptCredential,
  encryptCredential,
} from '../../infrastructure/security/credential-encryption';
import { mapNangoClientError, NangoIntegrationError } from './errors';
import type { NangoIntegration } from './schemas';
import { NangoClient } from './client';

type NangoClientLike = Pick<NangoClient, 'listIntegrations' | 'listConnections' | 'getConnection'>;

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

  async listIntegrations(): Promise<NangoIntegration[]> {
    const client = this.dependencies.createClient(await this.getRuntimeConfig());
    try {
      return await client.listIntegrations();
    } catch (error) {
      throw mapNangoClientError(error);
    }
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
      await client.listIntegrations();
      await client.listConnections();
      if (references.length > 0) {
        await mapWithConcurrency(uniqueReferences(references), 5, async (reference) => {
          await client.getConnection(reference.connectionId, reference.integrationId);
        });
      }
    } catch (error) {
      throw mapNangoClientError(error);
    }
  }
}

export { NangoIntegrationError } from './errors';

export const createNangoIntegrationService = (input: {
  repository: SystemIntegrationRepository;
  encryptionKey: string;
  fetch: typeof fetch;
  now(): Date;
}): NangoIntegrationService =>
  new NangoIntegrationService({
    repository: input.repository,
    encryptionKey: input.encryptionKey,
    createClient: (config) => new NangoClient({ ...config, fetch: input.fetch }),
    now: input.now,
  });
