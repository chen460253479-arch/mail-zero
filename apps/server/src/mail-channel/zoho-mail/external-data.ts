import { z } from 'zod';

const zohoResourceIdSchema = z.string().trim().regex(/^\d+$/u);

export const zohoMailExternalDataSchema = z
  .object({
    accountId: zohoResourceIdSchema,
    folderIds: z.array(zohoResourceIdSchema).min(1).max(100).optional(),
  })
  .strict()
  .superRefine(({ folderIds }, context) => {
    if (folderIds !== undefined && new Set(folderIds).size !== folderIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['folderIds'],
        message: 'folderIds must not contain duplicates',
      });
    }
  });

export type ZohoMailExternalData = z.infer<typeof zohoMailExternalDataSchema>;

export type CompleteZohoMailExternalData = ZohoMailExternalData & {
  folderIds: [string, ...string[]];
};

export const parseZohoMailExternalData = (value: unknown): ZohoMailExternalData =>
  zohoMailExternalDataSchema.parse(value);

export const isCompleteZohoMailExternalData = (
  value: unknown,
): value is CompleteZohoMailExternalData => {
  const parsed = zohoMailExternalDataSchema.safeParse(value);
  return parsed.success && parsed.data.folderIds !== undefined;
};

export const requireCompleteZohoMailExternalData = (
  value: unknown,
): CompleteZohoMailExternalData => {
  const parsed = parseZohoMailExternalData(value);
  if (parsed.folderIds === undefined) {
    throw new Error('ZOHO_MAIL_BINDING_INCOMPLETE');
  }
  return parsed as CompleteZohoMailExternalData;
};

export const mergeZohoMailExternalData = (
  existing: unknown,
  incoming: unknown,
): ZohoMailExternalData => {
  const next = parseZohoMailExternalData(incoming);
  if (next.folderIds !== undefined) return next;

  const previous = zohoMailExternalDataSchema.safeParse(existing);
  if (
    previous.success &&
    previous.data.accountId === next.accountId &&
    previous.data.folderIds !== undefined
  ) {
    return previous.data;
  }
  return next;
};
