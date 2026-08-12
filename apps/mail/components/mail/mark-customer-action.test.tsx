import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MarkCustomerAction } from './mark-customer-action';

const strings = {
  label: '标记为客户',
  title: '标记为客户',
  description: '将为 {sender} 创建或关联 CRM 客户。',
  cancel: '取消',
  confirm: '确认标记',
};

const candidate = {
  messageId: 'email-1',
  sender: { name: '张三', email: 'zhangsan@example.test' },
};

describe('MarkCustomerAction', () => {
  it('renders an icon-only action only when a customer candidate exists', () => {
    const markup = renderToStaticMarkup(
      <MarkCustomerAction
        candidate={candidate}
        pending={false}
        strings={strings}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain('data-mark-customer-action="true"');
    expect(markup).toContain('aria-label="标记为客户"');
    expect(markup).toContain('<svg');
    expect(
      renderToStaticMarkup(
        <MarkCustomerAction
          candidate={null}
          pending={false}
          strings={strings}
          onConfirm={vi.fn()}
        />,
      ),
    ).toBe('');
  });

  it('disables the trigger and displays a loading icon while submitting', () => {
    const markup = renderToStaticMarkup(
      <MarkCustomerAction
        candidate={candidate}
        pending
        strings={strings}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('animate-spin');
  });
});
