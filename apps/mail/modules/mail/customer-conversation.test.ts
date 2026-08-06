import { describe, expect, it } from 'vitest';

import {
  buildCustomerConversationUrl,
  DEFAULT_CUSTOMER_CONVERSATION_URL,
} from './customer-conversation';

describe('customer conversation URL', () => {
  it('adds the encoded customer id to the configured conversation URL', () => {
    expect(
      buildCustomerConversationUrl(
        'https://crm.example.com/conversation-list?source=mail',
        'customer / 123',
      ),
    ).toBe('https://crm.example.com/conversation-list?source=mail&exid=customer+%2F+123');
  });

  it('uses the deployment default when the environment value is empty', () => {
    expect(buildCustomerConversationUrl(undefined, 'customer-123')).toBe(
      `${DEFAULT_CUSTOMER_CONVERSATION_URL}?exid=customer-123`,
    );
  });

  it('rejects an invalid URL or an empty customer id', () => {
    expect(buildCustomerConversationUrl('not-a-url', 'customer-123')).toBeNull();
    expect(
      buildCustomerConversationUrl('https://crm.example.com/conversation-list', '  '),
    ).toBeNull();
  });
});
