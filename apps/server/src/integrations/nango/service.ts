import type { NangoConnection, NangoConnectionSummary, NangoIntegration } from './schemas';
import { NangoClient, NangoClientError, type NangoOperation } from './client';
import { mapNangoClientError, NangoIntegrationError } from './errors';

type NangoRuntimeConfig = {
  baseUrl: string;
  secretKey: string;
};

type NangoClientLike = Pick<
  NangoClient,
  'validateAccess' | 'listIntegrations' | 'listConnections' | 'getConnection'
>;

export type NangoRuntimeErrorCode =
  | 'NANGO_ENV_INCOMPLETE'
  | 'NANGO_ENV_INVALID'
  | 'NANGO_API_KEY_INVALID'
  | 'NANGO_ENDPOINT_NOT_FOUND'
  | 'NANGO_INSUFFICIENT_PERMISSIONS'
  | 'NANGO_INVALID_RESPONSE'
  | 'NANGO_REQUEST_FAILED'
  | 'NANGO_UNREACHABLE';

export type NangoRuntimeStatus =
  | { state: 'unconfigured'; checkedAt: null; errorCode: null }
  | { state: 'validating'; checkedAt: null; errorCode: null }
  | { state: 'available'; checkedAt: Date; errorCode: null }
  | {
      state: 'unavailable';
      checkedAt: Date;
      errorCode: NangoRuntimeErrorCode;
    };

type NangoIntegrationServiceDependencies = {
  baseUrl?: string;
  secretKey?: string;
  createClient(config: NangoRuntimeConfig): NangoClientLike;
  now(): Date;
  logError(
    code: NangoRuntimeErrorCode,
    details: { operation: NangoOperation | null; status: number | null },
  ): void;
};

const unconfiguredStatus = (): NangoRuntimeStatus => ({
  state: 'unconfigured',
  checkedAt: null,
  errorCode: null,
});

const validatingStatus = (): NangoRuntimeStatus => ({
  state: 'validating',
  checkedAt: null,
  errorCode: null,
});

const normalizeRuntimeConfig = (
  input: Pick<NangoIntegrationServiceDependencies, 'baseUrl' | 'secretKey'>,
):
  | { kind: 'unconfigured' }
  | { kind: 'invalid'; errorCode: NangoRuntimeErrorCode }
  | { kind: 'configured'; config: NangoRuntimeConfig } => {
  const baseUrl = input.baseUrl?.trim() ?? '';
  const secretKey = input.secretKey?.trim() ?? '';

  if (!baseUrl && !secretKey) return { kind: 'unconfigured' };
  if (!baseUrl || !secretKey) {
    return { kind: 'invalid', errorCode: 'NANGO_ENV_INCOMPLETE' };
  }

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'invalid', errorCode: 'NANGO_ENV_INVALID' };
    }
    return {
      kind: 'configured',
      config: {
        baseUrl: url.toString().replace(/\/+$/, ''),
        secretKey,
      },
    };
  } catch {
    return { kind: 'invalid', errorCode: 'NANGO_ENV_INVALID' };
  }
};

const toRuntimeFailure = (
  error: unknown,
): {
  errorCode: NangoRuntimeErrorCode;
  operation: NangoOperation | null;
  status: number | null;
} => {
  if (!(error instanceof NangoClientError)) {
    return {
      errorCode: 'NANGO_REQUEST_FAILED',
      operation: null,
      status: null,
    };
  }

  const errorCode: NangoRuntimeErrorCode =
    error.code === 'INVALID_API_KEY'
      ? 'NANGO_API_KEY_INVALID'
      : error.code === 'INSUFFICIENT_PERMISSIONS'
        ? 'NANGO_INSUFFICIENT_PERMISSIONS'
        : error.code === 'ENDPOINT_NOT_FOUND'
          ? 'NANGO_ENDPOINT_NOT_FOUND'
          : error.code === 'INVALID_RESPONSE'
            ? 'NANGO_INVALID_RESPONSE'
            : error.status === null
              ? 'NANGO_UNREACHABLE'
              : 'NANGO_REQUEST_FAILED';

  return {
    errorCode,
    operation: error.operation,
    status: error.status,
  };
};

export class NangoIntegrationService {
  private status: NangoRuntimeStatus;
  private initialization: Promise<NangoRuntimeStatus> | undefined;
  private client: NangoClientLike | undefined;
  private integrations: NangoIntegration[] | undefined;

  constructor(private readonly dependencies: NangoIntegrationServiceDependencies) {
    this.status =
      dependencies.baseUrl?.trim() || dependencies.secretKey?.trim()
        ? validatingStatus()
        : unconfiguredStatus();
  }

  getStatus(): NangoRuntimeStatus {
    return this.status;
  }

  initialize(): Promise<NangoRuntimeStatus> {
    if (!this.initialization) {
      this.initialization = this.runInitialization();
    }
    return this.initialization;
  }

  async listIntegrations(): Promise<NangoIntegration[]> {
    try {
      await this.getValidatedClient();
      return [...(this.integrations ?? [])];
    } catch (error) {
      if (error instanceof NangoIntegrationError) throw error;
      throw mapNangoClientError(error);
    }
  }

  async listConnections(integrationId?: string): Promise<NangoConnectionSummary[]> {
    try {
      return await (await this.getValidatedClient()).listConnections(integrationId);
    } catch (error) {
      if (error instanceof NangoIntegrationError) throw error;
      throw mapNangoClientError(error);
    }
  }

  async getConnection(connectionId: string, integrationId: string): Promise<NangoConnection> {
    try {
      return await (await this.getValidatedClient()).getConnection(connectionId, integrationId);
    } catch (error) {
      if (error instanceof NangoIntegrationError) throw error;
      throw mapNangoClientError(error);
    }
  }

  private async runInitialization(): Promise<NangoRuntimeStatus> {
    const result = normalizeRuntimeConfig(this.dependencies);

    if (result.kind === 'unconfigured') {
      this.status = unconfiguredStatus();
      return this.status;
    }

    if (result.kind === 'invalid') {
      return this.recordFailure(result.errorCode, null, null);
    }

    this.status = validatingStatus();

    try {
      this.client = this.dependencies.createClient(result.config);
      this.integrations = await this.client.validateAccess();
      this.status = {
        state: 'available',
        checkedAt: this.dependencies.now(),
        errorCode: null,
      };
      return this.status;
    } catch (error) {
      this.client = undefined;
      this.integrations = undefined;
      const failure = toRuntimeFailure(error);
      return this.recordFailure(failure.errorCode, failure.operation, failure.status);
    }
  }

  private async getValidatedClient(): Promise<NangoClientLike> {
    const status = await this.initialize();
    if (status.state === 'unconfigured') {
      throw new NangoIntegrationError('NANGO_NOT_CONFIGURED');
    }
    if (status.state !== 'available' || !this.client) {
      throw new NangoIntegrationError('NANGO_INTEGRATION_UNAVAILABLE');
    }
    return this.client;
  }

  private recordFailure(
    errorCode: NangoRuntimeErrorCode,
    operation: NangoOperation | null,
    status: number | null,
  ): NangoRuntimeStatus {
    this.status = {
      state: 'unavailable',
      checkedAt: this.dependencies.now(),
      errorCode,
    };
    this.dependencies.logError(errorCode, { operation, status });
    return this.status;
  }
}

export { NangoIntegrationError } from './errors';

export const createNangoIntegrationService = (input: {
  baseUrl?: string;
  secretKey?: string;
  fetch: typeof fetch;
  now(): Date;
  logError?: NangoIntegrationServiceDependencies['logError'];
}): NangoIntegrationService =>
  new NangoIntegrationService({
    baseUrl: input.baseUrl,
    secretKey: input.secretKey,
    createClient: (config) => new NangoClient({ ...config, fetch: input.fetch }),
    now: input.now,
    logError:
      input.logError ??
      ((code, details) => {
        console.error('Nango runtime validation failed', {
          code,
          operation: details.operation,
          status: details.status,
        });
      }),
  });
