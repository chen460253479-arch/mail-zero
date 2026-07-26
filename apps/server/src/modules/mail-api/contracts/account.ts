import { z } from 'zod';

import {
  decimalStringSchema,
  isoDateSchema,
  mailAccountIdSchema,
  mailIdSchema,
  nullableDecimalStringSchema,
  stateSchema,
} from './common';

export const accountStatusSchema = z.enum(['active', 'suspended', 'deleting']);

export const accountSchema = z.object({
  id: mailAccountIdSchema,
  connectionId: mailIdSchema,
  status: accountStatusSchema,
  timezone: z.string().min(1),
  state: z.union([stateSchema, decimalStringSchema]),
  storageQuotaBytes: nullableDecimalStringSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const accountListInputSchema = z.void();
export const accountGetInputSchema = z.object({ accountId: mailAccountIdSchema });
export const accountListResultSchema = z.object({ accounts: z.array(accountSchema) });

export type AccountDto = z.infer<typeof accountSchema>;
