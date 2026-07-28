import { z } from 'zod';

export const integrationKeys = ['gmail_zero_oauth'] as const;
export type IntegrationKey = (typeof integrationKeys)[number];

const gmailZeroOAuthPublicConfigSchema = z.object({
  clientId: z.string().trim().min(1),
});

export const integrationPublicSchemas = {
  gmail_zero_oauth: gmailZeroOAuthPublicConfigSchema,
} satisfies Record<IntegrationKey, z.ZodTypeAny>;

export type IntegrationPublicConfigMap = {
  gmail_zero_oauth: z.infer<typeof gmailZeroOAuthPublicConfigSchema>;
};

export const parsePublicConfig = <K extends IntegrationKey>(
  key: K,
  publicConfig: unknown,
): IntegrationPublicConfigMap[K] =>
  integrationPublicSchemas[key].parse(publicConfig) as IntegrationPublicConfigMap[K];

export const integrationOAuthPurposes = ['validate_config', 'connect_mailbox'] as const;
export type IntegrationOAuthPurpose = (typeof integrationOAuthPurposes)[number];
