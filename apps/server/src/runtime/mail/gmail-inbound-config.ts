type GmailInboundEnvironment = {
  GMAIL_PUBSUB_TOPIC_NAME?: string;
  GMAIL_PUBSUB_SUBSCRIPTION_NAME?: string;
  GMAIL_PUBSUB_PUSH_AUDIENCE?: string;
  GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT?: string;
};

export type GmailInboundConfig = {
  topicName: string;
  subscriptionName: string;
  pushAudience: string;
  pushServiceAccount: string;
};

const requireMatch = (
  environment: GmailInboundEnvironment,
  key: keyof GmailInboundEnvironment,
  pattern: RegExp,
): string => {
  const value = environment[key]?.trim() ?? '';
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
};

const requireAudience = (environment: GmailInboundEnvironment): string => {
  const key = 'GMAIL_PUBSUB_PUSH_AUDIENCE' as const;
  const value = environment[key]?.trim() ?? '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }
    return url.toString();
  } catch {
    throw new Error(`Invalid ${key}`);
  }
};

export const readGmailInboundConfig = (
  environment: GmailInboundEnvironment,
): GmailInboundConfig => ({
  topicName: requireMatch(
    environment,
    'GMAIL_PUBSUB_TOPIC_NAME',
    /^projects\/[^/\s]+\/topics\/[^/\s]+$/u,
  ),
  subscriptionName: requireMatch(
    environment,
    'GMAIL_PUBSUB_SUBSCRIPTION_NAME',
    /^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/u,
  ),
  pushAudience: requireAudience(environment),
  pushServiceAccount: requireMatch(
    environment,
    'GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT',
    /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/u,
  ),
});
