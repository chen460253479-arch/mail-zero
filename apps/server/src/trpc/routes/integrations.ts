import { z } from 'zod';

import { createPostgresConnectionRepository } from '../../modules/mail-accounts/postgres/connection-repository';
import { provisionGmailMailboxInDatabase } from '../../modules/mail-accounts/runtime/provision-gmail-mailbox';
import { NangoChannelMappingService } from '../../modules/mail-accounts/application/nango-channel-mapping';
import { type GmailOAuthService } from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { createGmailChannelConfigService } from '../../integrations/gmail/channel-config-service';
import { normalizeMailboxEmail } from '../../modules/mail-accounts/application/mailbox-identity';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { getNangoServiceForEnvironment } from '../../integrations/nango/runtime';
import type { NangoIntegrationService } from '../../integrations/nango/service';
import { gmailChannelConfigInputSchema } from '../../mail-channel/gmail/config';
import { createGmailOAuthApplication } from '../../runtime/mail/gmail-oauth';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { mailChannelIds } from '../../mail-channel/contracts';
import { mapIntegrationError } from './integration-errors';
import { adminProcedure, router } from '../trpc';
import type { ZeroEnv } from '../../env';
import { createDb } from '../../db';

type IntegrationServices = {
  nango: NangoIntegrationService;
  nangoChannels: NangoChannelMappingService;
  gmail: GmailOAuthService;
  gmailChannel: ReturnType<typeof createGmailChannelConfigService>;
};

const withIntegrationServices = async <T>(
  env: ZeroEnv,
  run: (services: IntegrationServices) => Promise<T>,
): Promise<T> => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const repository = createSystemIntegrationRepository(db);
    const channelConfigs = createChannelConfigRepository(db);
    const nango = getNangoServiceForEnvironment(env);
    return await run({
      nango,
      nangoChannels: new NangoChannelMappingService({
        repository,
        listIntegrations: () => nango.listIntegrations(),
        getChannel: (channelId) => defaultMailChannelRegistry.get(channelId),
      }),
      gmail: createGmailOAuthApplication({
        repository,
        saveMailbox: async (userId, mailbox, authorization) => {
          const result = await createPostgresConnectionRepository(db).saveBinding({
            userId,
            existingMailboxId: null,
            mailbox: {
              ...mailbox,
              normalizedEmail: normalizeMailboxEmail(mailbox.email),
            },
            authorization,
          });
          await provisionGmailMailboxInDatabase(db, env, {
            userId,
            connectionId: result.id,
            identity: {
              email: mailbox.email,
              name: mailbox.name,
            },
          });
          return result;
        },
        encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
        backendUrl: env.VITE_PUBLIC_BACKEND_URL,
      }),
      gmailChannel: createGmailChannelConfigService({
        channels: channelConfigs,
        integrations: repository,
        getNangoStatus: () => nango.getStatus(),
        publicBackendUrl: env.VITE_PUBLIC_BACKEND_URL,
        requestSubscriptionRefresh: async (provider) => {
          await createPostgresMailSyncRepository(db).markSubscriptionsDue({
            provider,
            dueAt: new Date(),
          });
        },
      }),
    });
  } finally {
    await conn.end();
  }
};

const gmailCandidateSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().optional(),
});

export const integrationsRouter = router({
  getChannels: adminProcedure.query(async ({ ctx }) => {
    return await withIntegrationServices(ctx.c.env, async ({ gmailChannel }) => {
      const gmailConfig = await gmailChannel.get();
      const displayNames = {
        gmail: 'Gmail',
        outlook: 'Outlook',
        zoho_mail: 'Zoho Mail',
        imap_smtp: 'IMAP/SMTP',
      } as const;
      return mailChannelIds.map((channelId) => {
        const plugin = defaultMailChannelRegistry.find(channelId);
        return {
          channelId,
          displayName: plugin?.displayName ?? displayNames[channelId],
          available: plugin !== undefined,
          configured: channelId === 'gmail' && gmailConfig.configured,
        };
      });
    });
  }),

  getGmailConfig: adminProcedure.query(async ({ ctx }) => {
    try {
      return await withIntegrationServices(ctx.c.env, ({ gmailChannel }) => gmailChannel.get());
    } catch (error) {
      mapIntegrationError(error);
    }
  }),

  saveGmailConfig: adminProcedure
    .input(gmailChannelConfigInputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIntegrationServices(ctx.c.env, ({ gmailChannel }) =>
          gmailChannel.save({ ...input, updatedBy: ctx.sessionUser.id }),
        );
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
