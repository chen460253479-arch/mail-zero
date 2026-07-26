import { z } from 'zod';

import {
  createNangoIntegrationService,
  type NangoIntegrationService,
} from '../../integrations/nango/service';
import { NangoChannelMappingService } from '../../modules/mail-accounts/application/nango-channel-mapping';
import { type GmailOAuthService } from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { createGmailOAuthApplication } from '../../runtime/mail/gmail-oauth';
import { getMailChannel } from '../../lib/mail-channel/registry';
import { mapIntegrationError } from './integration-errors';
import { getZeroDB } from '../../lib/server-utils';
import { adminProcedure, router } from '../trpc';
import type { ZeroEnv } from '../../env';
import { createDb } from '../../db';

type IntegrationServices = {
  repository: ReturnType<typeof createSystemIntegrationRepository>;
  nango: NangoIntegrationService;
  nangoChannels: NangoChannelMappingService;
  gmail: GmailOAuthService;
};

const withIntegrationServices = async <T>(
  env: ZeroEnv,
  run: (services: IntegrationServices) => Promise<T>,
): Promise<T> => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const repository = createSystemIntegrationRepository(db);
    const nango = createNangoIntegrationService({
      repository,
      encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
      fetch,
      now: () => new Date(),
    });
    return await run({
      repository,
      nango,
      nangoChannels: new NangoChannelMappingService({
        repository,
        listIntegrations: () => nango.listIntegrations(),
        getChannel: (channelId) => getMailChannel(channelId),
      }),
      gmail: createGmailOAuthApplication({
        repository,
        saveMailbox: async (userId, mailbox, authorization) =>
          await (await getZeroDB(userId)).createMailboxWithAuthorization(mailbox, authorization),
        encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
        backendUrl: env.VITE_PUBLIC_BACKEND_URL,
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
      return await withIntegrationServices(ctx.c.env, async ({ nangoChannels }) =>
        (await nangoChannels.listIntegrations('gmail')).map(({ unique_key, display_name }) => ({
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
        await withIntegrationServices(ctx.c.env, ({ nangoChannels }) =>
          nangoChannels.setMapping('gmail', input.integrationId),
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
