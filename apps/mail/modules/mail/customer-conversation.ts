export const DEFAULT_CUSTOMER_CONVERSATION_URL = 'http://vctest.voyaseek.cn/conversation-list';

export function buildCustomerConversationUrl(
  configuredUrl: string | undefined,
  customerId: string,
): string | null {
  const normalizedCustomerId = customerId.trim();
  if (!normalizedCustomerId) return null;

  try {
    const url = new URL(configuredUrl?.trim() || DEFAULT_CUSTOMER_CONVERSATION_URL);
    url.searchParams.set('exid', normalizedCustomerId);
    return url.toString();
  } catch {
    return null;
  }
}
