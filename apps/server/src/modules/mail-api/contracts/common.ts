import { z } from 'zod';

export const mailIdSchema = z.string().min(1).max(255);
export const mailAccountIdSchema = mailIdSchema;
export const stateSchema = z.string().min(1).max(255);
export const cursorSchema = z.string().min(1).max(4096);
export const isoDateSchema = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );
export const nullableIsoDateSchema = z.union([isoDateSchema, z.null()]);
export const decimalStringSchema = z
  .union([z.bigint(), z.number().int().nonnegative(), z.string().regex(/^(0|[1-9][0-9]*)$/u)])
  .transform((value) => value.toString());
export const nullableDecimalStringSchema = z.union([decimalStringSchema, z.null()]);

export const mailAddressSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().min(1),
});

export const booleanIdMapSchema = z.record(mailIdSchema, z.literal(true));
export const nullableBooleanIdMapSchema = z.record(
  mailIdSchema,
  z.union([z.literal(true), z.null()]),
);

export const setErrorSchema = z.object({
  code: z.string().min(1),
  details: z
    .object({
      entityId: z.string().optional(),
    })
    .default({}),
});

export const changesInputSchema = z.object({
  accountId: mailAccountIdSchema,
  sinceState: stateSchema,
  maxChanges: z.number().int().min(1).max(1000).default(100),
});

export const changesResultSchema = z.object({
  oldState: stateSchema,
  newState: stateSchema,
  hasMoreChanges: z.boolean(),
  created: z.array(mailIdSchema),
  updated: z.array(mailIdSchema),
  destroyed: z.array(mailIdSchema),
});

export type ChangesInput = z.infer<typeof changesInputSchema>;
export type ChangesResultDto = z.infer<typeof changesResultSchema>;
