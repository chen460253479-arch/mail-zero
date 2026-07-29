import type { GmailChannelConfig } from '../config';
import { handleGmailPush } from './handle-push';

type GmailSignal = {
  provider: 'gmail';
  externalAccount: string;
  cursorHint: string;
};

export type GmailWebhookDependencies = {
  getChannelConfig(): Promise<GmailChannelConfig>;
  recordSignal(signal: GmailSignal): Promise<string[]>;
  enqueueDiscover(syncId: string): Promise<void>;
};

export const handleGmailWebhookRequest = async (
  request: Request,
  dependencies: GmailWebhookDependencies,
): Promise<Response> => {
  const config = await dependencies.getChannelConfig();
  if (!config.inboxWatchEnabled) {
    return Response.json({ message: 'Watch disabled' }, { status: 200 });
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
