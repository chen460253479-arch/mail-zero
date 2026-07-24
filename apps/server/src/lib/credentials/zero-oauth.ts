import { z } from 'zod';

const zeroOAuthSnapshotSchema = z.object({
  type: z.literal('oauth2'),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  scope: z.string(),
});

export type ZeroOAuthSnapshot = z.infer<typeof zeroOAuthSnapshotSchema>;

export const createZeroOAuthSnapshot = (
  input: Omit<ZeroOAuthSnapshot, 'type'>,
): ZeroOAuthSnapshot => ({
  type: 'oauth2',
  ...input,
});

export const readZeroOAuthSnapshot = (value: unknown): ZeroOAuthSnapshot =>
  zeroOAuthSnapshotSchema.parse(value);
