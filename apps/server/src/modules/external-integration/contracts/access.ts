import { z } from 'zod';

const nangoConnectionIdSchema = z.string().trim().min(1).max(255);

export const accessGrantInputSchema = z
  .object({
    allowedNangoConnectIds: z.array(nangoConnectionIdSchema).min(1).max(50),
  })
  .strict()
  .superRefine(({ allowedNangoConnectIds }, context) => {
    if (new Set(allowedNangoConnectIds).size !== allowedNangoConnectIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedNangoConnectIds'],
        message: 'Nango connection IDs must be unique',
      });
    }
  });

export const accessGrantResponseSchema = z
  .object({
    launchCode: z.string().min(1),
  })
  .strict();

export const launchCodeInputSchema = z
  .object({
    launchCode: z.string().min(1),
  })
  .strict();

export type AccessGrantInput = z.infer<typeof accessGrantInputSchema>;

export type GrantedMailboxScope = {
  nangoConnectionId: string;
  connectionId: string;
  mailAccountId: string;
};

export type ExternalBrowserSession = {
  id: string;
  ownerUserId: 'zero-external-integration';
  scopes: GrantedMailboxScope[];
  activeConnectionId: string;
  expiresAt: Date;
  updatedAt: Date;
};
