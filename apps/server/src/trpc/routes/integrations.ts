import { z } from 'zod';

import { createPostgresConnectionRepository } from '../../modules/mail-accounts/postgres/connection-repository';
import { provisionGmailMailboxInDatabase } from '../../modules/mail-accounts/runtime/provision-gmail-mailbox';
import { createMailChannelConfigService } from '../../integrations/mail-channel/channel-config-service';
import { type GmailOAuthService } from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { createGmailChannelConfigService } from '../../integrations/gmail/channel-config-service';
import { normalizeMailboxEmail } from '../../modules/mail-accounts/application/mailbox-identity';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { createChannelOAuthApplication } from '../../runtime/mail/channel-oauth';
import { gmailChannelConfigInputSchema } from '../../mail-channel/gmail/config';
import { disableChannelSubscriptions } from '../../runtime/mail/channel-watch';
import { createGmailOAuthApplication } from '../../runtime/mail/gmail-oauth';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { mailChannelConfigInputSchema } from '../../mail-channel/config';
import type { RuntimeServices } from '../../runtime/node/services';
import { mailChannelIds } from '../../mail-channel/contracts';
import { mapIntegrationError } from './integration-errors';
import { adminProcedure, router } from '../trpc';

type IntegrationServices = {
  gmail: GmailOAuthService;
  outlookOAuth: ReturnType<typeof createChannelOAuthApplication>;
  zohoOAuth: ReturnType<typeof createChannelOAuthApplication>;
  gmailChannel: ReturnType<typeof createGmailChannelConfigService>;
  channels: ReturnType<typeof createMailChannelConfigService>;
};

const withIntegrationServices = async <T>(
  runtime: RuntimeServices,
  run: (services: IntegrationServices) => Promise<T>,
): Promise<T> => {
  const { db } = runtime.database;
  const env = runtime.environment;
  const repository = createSystemIntegrationRepository(db);
  const channelConfigs = createChannelConfigRepository(db);
  const nangoChannels = runtime.nangoChannels;
  return await run({
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
        await provisionGmailMailboxInDatabase(db, runtime, {
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
    outlookOAuth: createChannelOAuthApplication(db, runtime, 'outlook'),
    zohoOAuth: createChannelOAuthApplication(db, runtime, 'zoho_mail'),
    gmailChannel: createGmailChannelConfigService({
      channels: channelConfigs,
      integrations: repository,
      getNangoStatus: () => nangoChannels.getStatus('gmail'),
      publicBackendUrl: env.VITE_PUBLIC_BACKEND_URL,
      requestSubscriptionRefresh: async (provider) => {
        await createPostgresMailSyncRepository(db).markSubscriptionsDue({
          provider,
          dueAt: new Date(),
        });
      },
      disableSubscriptions: async (provider) => {
        await disableChannelSubscriptions(db, runtime, provider);
      },
    }),
    channels: createMailChannelConfigService({
      channels: channelConfigs,
      integrations: repository,
      getNangoStatus: (channelId) => nangoChannels.getStatus(channelId),
      publicBackendUrl: env.VITE_PUBLIC_BACKEND_URL,
      protocolAvailable: defaultMailChannelRegistry.find('imap_smtp') !== undefined,
      requestSubscriptionRefresh: async (provider) => {
        await createPostgresMailSyncRepository(db).markSubscriptionsDue({
          provider,
          dueAt: new Date(),
        });
      },
      disableSubscriptions: async (provider) => {
        await disableChannelSubscriptions(db, runtime, provider);
      },
    }),
  });
};

const gmailCandidateSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().optional(),
});

export const integrationsRouter = router({
  getChannels: adminProcedure.query(async ({ ctx }) => {
    return await withIntegrationServices(
      ctx.c.var.services!,
      async ({ gmailChannel, channels }) => {
        const [gmailConfig, outlookConfig, zohoConfig, imapConfig] = await Promise.all([
          gmailChannel.get(),
          channels.get('outlook'),
          channels.get('zoho_mail'),
          channels.get('imap_smtp'),
        ]);
        const configurations = {
          gmail: gmailConfig,
          outlook: outlookConfig,
          zoho_mail: zohoConfig,
          imap_smtp: imapConfig,
        };
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
            configured: configurations[channelId].configured,
          };
        });
      },
    );
  }),

  getGmailConfig: adminProcedure.query(async ({ ctx }) => {
    try {
      return await withIntegrationServices(ctx.c.var.services!, ({ gmailChannel }) =>
        gmailChannel.get(),
      );
    } catch (error) {
      mapIntegrationError(error);
    }
  }),

  saveGmailConfig: adminProcedure
    .input(gmailChannelConfigInputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIntegrationServices(ctx.c.var.services!, ({ gmailChannel }) =>
          gmailChannel.save({ ...input, updatedBy: ctx.sessionUser.id }),
        );
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  getChannelConfig: adminProcedure
    .input(z.object({ channelId: z.enum(['outlook', 'zoho_mail', 'imap_smtp']) }))
    .query(async ({ input, ctx }) => {
      try {
        return await withIntegrationServices(ctx.c.var.services!, ({ channels }) =>
          channels.get(input.channelId),
        );
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  saveChannelConfig: adminProcedure
    .input(mailChannelConfigInputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.channelId === 'gmail') {
          return await withIntegrationServices(ctx.c.var.services!, ({ gmailChannel }) =>
            gmailChannel.save({ ...input, updatedBy: ctx.sessionUser.id }),
          );
        }
        return await withIntegrationServices(ctx.c.var.services!, ({ channels }) =>
          channels.save({ ...input, updatedBy: ctx.sessionUser.id }),
        );
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  startGmailValidation: adminProcedure
    .input(gmailCandidateSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIntegrationServices(ctx.c.var.services!, ({ gmail }) =>
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
        const status = await withIntegrationServices(ctx.c.var.services!, ({ gmail }) =>
          gmail.getValidationStatus(input.sessionId, ctx.sessionUser.id),
        );
        return { status };
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  deleteGmailZeroOAuth: adminProcedure.mutation(async ({ ctx }) => {
    try {
      await withIntegrationServices(ctx.c.var.services!, ({ gmail }) => gmail.delete());
      return { deleted: true };
    } catch (error) {
      mapIntegrationError(error);
    }
  }),

  startChannelOAuthValidation: adminProcedure
    .input(
      gmailCandidateSchema.extend({
        channelId: z.enum(['outlook', 'zoho_mail']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIntegrationServices(ctx.c.var.services!, (services) =>
          (input.channelId === 'outlook'
            ? services.outlookOAuth
            : services.zohoOAuth
          ).startValidation({
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            adminId: ctx.sessionUser.id,
          }),
        );
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  getChannelOAuthValidationStatus: adminProcedure
    .input(
      z.object({
        channelId: z.enum(['outlook', 'zoho_mail']),
        sessionId: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const status = await withIntegrationServices(ctx.c.var.services!, (services) =>
          (input.channelId === 'outlook'
            ? services.outlookOAuth
            : services.zohoOAuth
          ).getValidationStatus(input.sessionId, ctx.sessionUser.id),
        );
        return { status };
      } catch (error) {
        mapIntegrationError(error);
      }
    }),

  deleteChannelZeroOAuth: adminProcedure
    .input(z.object({ channelId: z.enum(['outlook', 'zoho_mail']) }))
    .mutation(async ({ input, ctx }) => {
      try {
        await withIntegrationServices(ctx.c.var.services!, (services) =>
          (input.channelId === 'outlook' ? services.outlookOAuth : services.zohoOAuth).delete(),
        );
        return { deleted: true };
      } catch (error) {
        mapIntegrationError(error);
      }
    }),
});
