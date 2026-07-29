type OutlookNotification = {
  subscriptionId: string;
  clientState: string;
  resource: string;
};

const parseNotifications = (payload: unknown): OutlookNotification[] => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
  const value = (payload as Record<string, unknown>).value;
  if (!Array.isArray(value)) return [];
  const notifications: OutlookNotification[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.subscriptionId !== 'string' ||
      record.subscriptionId.length === 0 ||
      typeof record.clientState !== 'string' ||
      record.clientState.length === 0 ||
      typeof record.resource !== 'string'
    ) {
      continue;
    }
    notifications.push({
      subscriptionId: record.subscriptionId,
      clientState: record.clientState,
      resource: record.resource,
    });
  }
  return notifications;
};

export type OutlookPushDependencies = {
  verifySubscription(input: OutlookNotification): Promise<boolean>;
  recordSubscriptionSignal(input: {
    provider: 'outlook';
    subscriptionExternalId: string;
  }): Promise<string[]>;
  enqueueDiscover(syncId: string): Promise<void>;
};

export const handleOutlookPush = async (
  payload: unknown,
  dependencies: OutlookPushDependencies,
): Promise<{ accepted: number; matched: number; queued: number }> => {
  const verifiedIds = new Set<string>();
  for (const notification of parseNotifications(payload)) {
    if (await dependencies.verifySubscription(notification)) {
      verifiedIds.add(notification.subscriptionId);
    }
  }

  let matched = 0;
  let queued = 0;
  for (const subscriptionExternalId of verifiedIds) {
    const syncIds = await dependencies.recordSubscriptionSignal({
      provider: 'outlook',
      subscriptionExternalId,
    });
    matched += syncIds.length;
    const wakeups = await Promise.allSettled(
      syncIds.map((syncId) => dependencies.enqueueDiscover(syncId)),
    );
    queued += wakeups.filter(({ status }) => status === 'fulfilled').length;
  }
  return {
    accepted: verifiedIds.size,
    matched,
    queued,
  };
};
