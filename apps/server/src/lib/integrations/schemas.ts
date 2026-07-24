import { z } from 'zod';

export const integrationKeys = ['nango', 'gmail_zero_oauth'] as const;
export type IntegrationKey = (typeof integrationKeys)[number];

const nangoPublicConfigSchema = z.object({
  baseUrl: z.string().url(),
});

const gmailZeroOAuthPublicConfigSchema = z.object({
  clientId: z.string().trim().min(1),
});

export const integrationPublicSchemas = {
  nango: nangoPublicConfigSchema,
  gmail_zero_oauth: gmailZeroOAuthPublicConfigSchema,
} satisfies Record<IntegrationKey, z.ZodTypeAny>;

export type IntegrationPublicConfigMap = {
  nango: z.infer<typeof nangoPublicConfigSchema>;
  gmail_zero_oauth: z.infer<typeof gmailZeroOAuthPublicConfigSchema>;
};

export const parsePublicConfig = <K extends IntegrationKey>(
  key: K,
  value: unknown,
): IntegrationPublicConfigMap[K] =>
  integrationPublicSchemas[key].parse(value) as IntegrationPublicConfigMap[K];

export const integrationOAuthPurposes = ['validate_config', 'connect_mailbox'] as const;
export type IntegrationOAuthPurpose = (typeof integrationOAuthPurposes)[number];
