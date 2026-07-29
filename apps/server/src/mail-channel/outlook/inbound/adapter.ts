import {
  createOutlookInboxDeltaUrl,
  type MicrosoftGraphClient,
  type OutlookDeltaPage,
} from '../shared/graph-client';
import {
  MailSyncError,
  parseIngressScope,
  type InboundMailAdapter,
} from '../../../modules/mail-sync';
import { createOutlookSubscription, parseOutlookSubscriptionTarget } from './subscription';
import { createOutlookCheckpoint, parseOutlookCheckpoint } from './checkpoint';
import { classifyOutlookError, outlookErrorStatus } from '../shared/errors';
import { mapOutlookDeltaMessages } from './delta-mapper';

const MAX_BASELINE_PAGES = 1_000;

const requireFinalDeltaLink = (page: OutlookDeltaPage): string => {
  if (page.deltaLink === null) {
    throw new MailSyncError('OUTLOOK_DELTA_LINK_MISSING', 'retryable');
  }
  return page.deltaLink;
};

const establishBaseline = async (
  client: MicrosoftGraphClient,
  receivedAfter: Date,
): Promise<string> => {
  const seen = new Set<string>();
  let url = createOutlookInboxDeltaUrl(receivedAfter);
  for (let pages = 0; pages < MAX_BASELINE_PAGES; pages += 1) {
    if (seen.has(url)) {
      throw new MailSyncError('OUTLOOK_DELTA_CURSOR_LOOP', 'permanent');
    }
    seen.add(url);
    const page = await client.getDeltaPage(url);
    if (page.nextLink === null) return requireFinalDeltaLink(page);
    url = page.nextLink;
  }
  throw new MailSyncError('OUTLOOK_DELTA_BASELINE_TOO_LARGE', 'permanent');
};

export const createOutlookIngressAdapter = (
  client: MicrosoftGraphClient,
  clock: { now(): Date } = { now: () => new Date() },
): InboundMailAdapter => ({
  provider: 'outlook',

  establishCheckpoint: async (scope) => {
    parseIngressScope(scope);
    const baselineAt = clock.now();
    return createOutlookCheckpoint({
      cursorUrl: await establishBaseline(client, baselineAt),
      lastSuccessfulAt: baselineAt,
    });
  },

  discover: async ({ scope, checkpoint, pageToken }) => {
    parseIngressScope(scope);
    const state = parseOutlookCheckpoint(checkpoint);
    let page: OutlookDeltaPage;
    try {
      page = await client.getDeltaPage(pageToken ?? state.cursorUrl);
    } catch (error) {
      if (outlookErrorStatus(error) !== 410) throw error;
      page = await client.getDeltaPage(
        createOutlookInboxDeltaUrl(new Date(state.lastSuccessfulAt)),
      );
    }
    const finishedAt = clock.now();
    return {
      events: mapOutlookDeltaMessages(page.messages),
      nextPageToken: page.nextLink,
      checkpoint:
        page.nextLink === null
          ? createOutlookCheckpoint({
              cursorUrl: requireFinalDeltaLink(page),
              lastSuccessfulAt: finishedAt,
            })
          : state,
    };
  },

  fetchRawMessage: async ({ scope, remoteMessageId }) => {
    parseIngressScope(scope);
    const raw = await client.getRawMessage(remoteMessageId);
    return {
      remoteMessageId,
      raw,
      receivedAt: null,
    };
  },

  subscribe: async ({ scope, checkpoint, target, currentSubscription }) => {
    parseIngressScope(scope);
    parseOutlookCheckpoint(checkpoint);
    return await createOutlookSubscription(
      client,
      parseOutlookSubscriptionTarget(target),
      currentSubscription,
    );
  },

  classifyError: classifyOutlookError,
});
