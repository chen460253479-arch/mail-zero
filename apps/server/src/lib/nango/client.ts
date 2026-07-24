import { z } from 'zod';

import {
  nangoConnectionSchema,
  nangoConnectionSummarySchema,
  nangoIntegrationSchema,
  type NangoConnection,
  type NangoConnectionSummary,
  type NangoIntegration,
} from './types';

const integrationListSchema = z.object({
  data: z.array(nangoIntegrationSchema),
});

const connectionListSchema = z.union([
  z.object({ data: z.array(nangoConnectionSummarySchema) }),
  z.object({ connections: z.array(nangoConnectionSummarySchema) }),
]);

type NangoErrorCode = 'INVALID_CREDENTIALS' | 'REQUEST_FAILED' | 'INVALID_RESPONSE';

export class NangoClientError extends Error {
  constructor(
    public readonly code: NangoErrorCode,
    public readonly status: number | null,
    options?: ErrorOptions,
  ) {
    super(`Nango request failed (${code})`, options);
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
    const payload = await this.request('/integrations');
    return this.parse(integrationListSchema, payload).data;
  }

  async listConnections(integrationId: string): Promise<NangoConnectionSummary[]> {
    const pageSize = 100;
    const connections: NangoConnectionSummary[] = [];
    const seen = new Set<string>();

    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ limit: String(pageSize), page: String(page) });
      const payload = await this.request(`/connections?${query.toString()}`);
      const result = this.parse(connectionListSchema, payload);
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

    return connections.filter(({ provider_config_key }) => provider_config_key === integrationId);
  }

  async getConnection(connectionId: string, integrationId: string): Promise<NangoConnection> {
    if (!integrationId) {
      throw new TypeError('integrationId is required');
    }

    const query = new URLSearchParams({ provider_config_key: integrationId });
    const path = `/connections/${encodeURIComponent(connectionId)}?${query.toString()}`;
    return this.parse(nangoConnectionSchema, await this.request(path));
  }

  private async request(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.config.fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.config.secretKey}` },
      });
    } catch (error) {
      throw new NangoClientError('REQUEST_FAILED', null, { cause: error });
    }

    if (!response.ok) {
      const code = response.status === 424 ? 'INVALID_CREDENTIALS' : 'REQUEST_FAILED';
      throw new NangoClientError(code, response.status);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new NangoClientError('INVALID_RESPONSE', response.status, { cause: error });
    }
  }

  private parse<T extends z.ZodTypeAny>(schema: T, payload: unknown): z.output<T> {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new NangoClientError('INVALID_RESPONSE', 200, { cause: result.error });
    }
    return result.data;
  }
}
