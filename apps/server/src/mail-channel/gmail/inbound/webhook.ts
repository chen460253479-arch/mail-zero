import { authenticateGmailPush, type GmailPushAuthenticationConfig } from './push-auth';
import type { GmailChannelConfig, GmailChannelProviderConfig } from '../config';
import { handleGmailPush } from './handle-push';

type GmailSignal = {
  provider: 'gmail';
  externalAccount: string;
  cursorHint: string;
};

export type GmailWebhookDependencies = {
  getChannelConfig(): Promise<GmailChannelConfig>;
  authenticatePush(
    input: {
      authorizationHeader: string | undefined;
      subscriptionName: string | undefined;
    },
    config: GmailPushAuthenticationConfig,
  ): Promise<boolean>;
  recordSignal(signal: GmailSignal): Promise<string[]>;
  enqueueDiscover(syncId: string): Promise<void>;
};

const requiredPushConfig = (
  providerConfig: GmailChannelProviderConfig,
): GmailPushAuthenticationConfig => ({
  topicName: providerConfig.topicName!,
  subscriptionName: providerConfig.subscriptionName!,
  pushAudience: providerConfig.pushAudience!,
  pushServiceAccount: providerConfig.pushServiceAccount!,
});

export const handleGmailWebhookRequest = async (
  request: Request,
  dependencies: GmailWebhookDependencies,
): Promise<Response> => {
  const config = await dependencies.getChannelConfig();
  if (!config.inboxWatchEnabled) {
    return Response.json({ message: 'Watch disabled' }, { status: 200 });
  }

  const authenticated = await dependencies.authenticatePush(
    {
      authorizationHeader: request.headers.get('authorization') ?? undefined,
      subscriptionName: request.headers.get('x-goog-pubsub-subscription-name') ?? undefined,
    },
    requiredPushConfig(config.providerConfig),
  );
  if (!authenticated) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const handled = await handleGmailPush(payload, {
    recordSignal: dependencies.recordSignal,
    enqueueDiscover: dependencies.enqueueDiscover,
  });
  if (!handled.accepted) {
    return new Response(null, { status: 204 });
  }
  return Response.json(
    {
      message: 'OK',
      matched: handled.matched,
      queued: handled.queued,
    },
    { status: 200 },
  );
};

export const defaultGmailPushAuthenticator: GmailWebhookDependencies['authenticatePush'] =
  authenticateGmailPush;
