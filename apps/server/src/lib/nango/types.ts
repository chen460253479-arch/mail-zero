import { z } from 'zod';

const recordSchema = z.record(z.string(), z.unknown());
const tagsSchema = z.record(z.string(), z.string());
const connectionErrorSchema = z.object({
  type: z.string(),
  log_id: z.string(),
});

export const nangoIntegrationSchema = z.object({
  unique_key: z.string().min(1),
  display_name: z.string().min(1),
  provider: z.string().min(1),
});

export const nangoConnectionSummarySchema = z.object({
  connection_id: z.string().min(1),
  provider_config_key: z.string().min(1),
  provider: z.string().min(1),
  metadata: recordSchema.nullable().default(null),
  tags: tagsSchema.default({}),
  errors: z.array(connectionErrorSchema).default([]),
});

const oauth2CredentialSchema = z.object({
  type: z.literal('OAUTH2'),
  access_token: z.string().min(1),
  expires_at: z.union([z.string(), z.number()]).nullable().optional(),
  raw: recordSchema.default({}),
});

const basicCredentialSchema = z.object({
  type: z.literal('BASIC'),
  username: z.string(),
  password: z.string(),
  raw: recordSchema.default({}),
});

const customCredentialSchema = z.object({
  type: z.literal('CUSTOM'),
  raw: recordSchema,
});

export const nangoCredentialSchema = z.discriminatedUnion('type', [
  oauth2CredentialSchema,
  basicCredentialSchema,
  customCredentialSchema,
]);

export const nangoConnectionSchema = nangoConnectionSummarySchema.extend({
  credentials: nangoCredentialSchema,
});

export type NangoIntegration = z.infer<typeof nangoIntegrationSchema>;
export type NangoConnectionSummary = z.infer<typeof nangoConnectionSummarySchema>;
export type NangoConnection = z.infer<typeof nangoConnectionSchema>;
export type NangoCredential = z.infer<typeof nangoCredentialSchema>;
