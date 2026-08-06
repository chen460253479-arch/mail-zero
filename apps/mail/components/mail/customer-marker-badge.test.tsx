import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerMarkerBadge } from './customer-marker-badge';

describe('CustomerMarkerBadge', () => {
  it('renders a fixed customer icon with the localized customer label', () => {
    const markup = renderToStaticMarkup(
      <CustomerMarkerBadge label={{ name: 'Customer email · Acme' }} />,
    );

    expect(markup).toContain('data-customer-marker="true"');
    expect(markup).toContain('aria-label="Customer email · Acme"');
    expect(markup).toContain('<svg');
  });
});
