import { z } from 'zod';

import {
  GmailOAuthService,
  gmailOAuthRedirectUris,
} from '../../lib/integrations/gmail-oauth-service';
import { createSystemIntegrationRepository } from '../../lib/integrations/repository';
import { GoogleGmailOAuthGateway } from '../../lib/integrations/google-gmail-oauth';
import { NangoIntegrationService } from '../../lib/integrations/nango-service';
import { mapIntegrationError } from './integration-errors';
import { NangoClient } from '../../lib/nango/client';
import { getZeroDB } from '../../lib/server-utils';
import { adminProcedure, router } from '../trpc';
import type { ZeroEnv } from '../../env';
import { createDb } from '../../db';

type IntegrationServices = {
  repository: ReturnType<typeof createSystemIntegrationRepository>;
  nango: NangoIntegrationService;
  gmail: GmailOAuthService;
};

const withIntegrationServices = async <T>(
  env: ZeroEnv,
  run: (services: IntegrationServices) => Promise<T>,
): Promise<T> => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const repository = createSystemIntegrationRepository(db);
    return await run({
      repository,
      nango: new NangoIntegrationService({
        repository,
        encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
        createClient: (config) => new NangoClient({ ...config, fetch }),
        now: () => new Date(),
      }),
      gmail: new GmailOAuthService({
        repository,
        mailboxRepository: {
          save: async (userId, mailbox, authorization) =>
            await (await getZeroDB(userId)).createMailboxWithAuthorization(mailbox, authorization),
        },
        gateway: new GoogleGmailOAuthGateway(),
        encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
        redirectUris: gmailOAuthRedirectUris(env.VITE_PUBLIC_BACKEND_URL),
        now: () => new Date(),
      }),
    });
  } finally {
    await conn.end();
  }
};

const nangoCandidateSchema = z.object({
  baseUrl: z.string().url(),
  secretKey: z.string().optional(),
});

const gmailCandidateSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().optional(),
});

export const integrationsRouter = router({
  getOverview: adminProcedure.query(async ({ ctx }) => {
    return await withIntegrationServices(ctx.c.env, async ({ repository, nango, gmail }) => {
      const [nangoConfig, gmailConfig, gmailMapping, nangoBindingCount, gmailBindingCount] =
        await Promise.all([
          nango.getSafeConfig(),
          gmail.getSafeConfig(),
          repository.getMapping('gmail', 'nango'),
          repository.countNangoBindings(),
          repository.countZeroOAuthBindings('gmail'),
        ]);
      return {
        nango: {
          ...nangoConfig,
          gmailIntegrationId: gmailMapping?.externalIntegrationId ?? null,
          bindingCount: nangoBindingCount,
        },
        gmail: {
          ...gmailConfig,
          bindingCount: gmailBindingCount,
        },
      };
    });
  }),

  validateAndSaveNango: adminProcedure
    .input(nangoCandidateSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIntegrationServices(ctx.c.env, ({ nango }) =>
          nango.validateAndSave({ ...input, updatedBy: ctx.sessionUser.id }),
        );
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  deleteNango: adminProcedure.mutation(async ({ ctx }) => {
    try {
      await withIntegrationServices(ctx.c.env, ({ nango }) => nango.delete());
      return { deleted: true };
    } catch (error) {
      mapIntegrationError(error);
    }
  }),

  listNangoGmailIntegrations: adminProcedure.query(async ({ ctx }) => {
    try {
      return await withIntegrationServices(ctx.c.env, async ({ nango }) =>
        (await nango.listGmailIntegrations()).map(({ unique_key, display_name }) => ({
          integrationId: unique_key,
          displayName: display_name,
        })),
      );
    } catch (error) {
      mapIntegrationError(error);
    }
  }),

  setNangoGmailIntegration: adminProcedure
    .input(z.object({ integrationId: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        await withIntegrationServices(ctx.c.env, ({ nango }) =>
          nango.setGmailMapping(input.integrationId),
        );
        return { saved: true };
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  startGmailValidation: adminProcedure
    .input(gmailCandidateSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIntegrationServices(ctx.c.env, ({ gmail }) =>
          gmail.startValidation({ ...input, adminId: ctx.sessionUser.id }),
        );
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  getGmailValidationStatus: adminProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      try {
        const status = await withIntegrationServices(ctx.c.env, ({ gmail }) =>
          gmail.getValidationStatus(input.sessionId, ctx.sessionUser.id),
        );
        return { status };
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  deleteGmailZeroOAuth: adminProcedure.mutation(async ({ ctx }) => {
    try {
      await withIntegrationServices(ctx.c.env, ({ gmail }) => gmail.delete());
      return { deleted: true };
    } catch (error) {
      mapIntegrationError(error);
    }
  }),
});
