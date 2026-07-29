import { z } from 'zod';

import type { ImapSmtpCredential } from '../../../mail-channel/contracts';

export const protocolEndpointSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean(),
});

export const manualCredentialSnapshotSchema = z.object({
  type: z.literal('imap_smtp'),
  email: z.string().trim().email(),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  imap: protocolEndpointSchema,
  smtp: protocolEndpointSchema,
});

export const createManualCredentialSnapshot = (
  credential: ImapSmtpCredential,
): ImapSmtpCredential => manualCredentialSnapshotSchema.parse(credential);

export const readManualCredentialSnapshot = (value: unknown): ImapSmtpCredential =>
  manualCredentialSnapshotSchema.parse(value);
