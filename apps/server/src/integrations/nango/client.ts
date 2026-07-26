import { z } from 'zod';

import {
  nangoConnectionSchema,
  nangoConnectionSummarySchema,
  nangoIntegrationSchema,
  type NangoConnection,
  type NangoConnectionSummary,
  type NangoIntegration,
} from './schemas';

const integrationListSchema = z.object({
  data: z.array(nangoIntegrationSchema),
});

const connectionListSchema = z.union([
  z.object({ data: z.array(nangoConnectionSummarySchema) }),
  z.object({ connections: z.array(nangoConnectionSummarySchema) }),
]);

type NangoErrorCode =
  | 'ENDPOINT_NOT_FOUND'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'INVALID_API_KEY'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED';

export type NangoOperation = 'get_connection' | 'list_connections' | 'list_integrations';

export class NangoClientError extends Error {
  constructor(
    public readonly code: NangoErrorCode,
    public readonly status: number | null,
    public readonly operation: NangoOperation,
    options?: ErrorOptions,
  ) {
    super(`Nango ${operation} failed (${code}${status === null ? '' : `, ${status}`})`, options);
    this.name = 'NangoClientError';
  }
}

export class NangoClient {
  private readonly baseUrl: string;

  constructor(
    private readonly config: {
      baseUrl: string;
      secretKey: string;
      fetch: typeof fetch;
    },
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  async listIntegrations(): Promise<NangoIntegration[]> {
    const operation = 'list_integrations';
    const payload = await this.request('/integrations', operation);
    return this.parse(integrationListSchema, payload, operation).data;
  }

  async listConnections(integrationId?: string): Promise<NangoConnectionSummary[]> {
    const operation = 'list_connections';
    const pageSize = 100;
    const connections: NangoConnectionSummary[] = [];
    const seen = new Set<string>();

    for (let page = 0; ; page++) {
      const query = new URLSearchParams({ limit: String(pageSize), page: String(page) });
      const payload = await this.request(`/connections?${query.toString()}`, operation);
      const result = this.parse(connectionListSchema, payload, operation);
      const pageConnections = 'data' in result ? result.data : result.connections;
      let added = 0;

      for (const connection of pageConnections) {
        const key = `${connection.provider_config_key}\u0000${connection.connection_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        connections.push(connection);
        added++;
      }

      if (pageConnections.length < pageSize || added === 0) break;
    }

    return integrationId
      ? connections.filter(({ provider_config_key }) => provider_config_key === integrationId)
      : connections;
  }

  async getConnection(connectionId: string, integrationId: string): Promise<NangoConnection> {
    if (!integrationId) {
      throw new TypeError('integrationId is required');
    }

    const query = new URLSearchParams({ provider_config_key: integrationId });
    const path = `/connections/${encodeURIComponent(connectionId)}?${query.toString()}`;
    const operation = 'get_connection';
    return this.parse(nangoConnectionSchema, await this.request(path, operation), operation);
  }

  private async request(path: string, operation: NangoOperation): Promise<unknown> {
    let response: Response;
    try {
      const fetchImpl = this.config.fetch;
      response = await fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.config.secretKey}` },
      });
    } catch (error) {
      throw new NangoClientError('REQUEST_FAILED', null, operation, { cause: error });
    }

    if (!response.ok) {
      const code: NangoErrorCode =
        response.status === 401
          ? 'INVALID_API_KEY'
          : response.status === 403
            ? 'INSUFFICIENT_PERMISSIONS'
            : response.status === 404
              ? 'ENDPOINT_NOT_FOUND'
              : response.status === 424
                ? 'INVALID_CREDENTIALS'
                : 'REQUEST_FAILED';
      throw new NangoClientError(code, response.status, operation);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new NangoClientError('INVALID_RESPONSE', response.status, operation, { cause: error });
    }
  }

  private parse<T extends z.ZodTypeAny>(
    schema: T,
    payload: unknown,
    operation: NangoOperation,
  ): z.output<T> {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new NangoClientError('INVALID_RESPONSE', 200, operation, { cause: result.error });
    }
    return result.data;
  }
}
