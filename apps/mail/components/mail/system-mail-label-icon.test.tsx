import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SystemMailLabelIcon } from './system-mail-label-icon';

describe('SystemMailLabelIcon', () => {
  it('renders the important system label as an orange lightning icon', () => {
    const markup = renderToStaticMarkup(<SystemMailLabelIcon label="IMPORTANT" />);

    expect(markup).toContain('<svg');
    expect(markup).toContain('fill-orange-400');
  });

  it('keeps the starred system label as a yellow star icon', () => {
    const markup = renderToStaticMarkup(<SystemMailLabelIcon label="STARRED" />);

    expect(markup).toContain('<svg');
    expect(markup).toContain('fill-yellow-400');
  });

  it('does not render an icon for an ordinary label', () => {
    expect(renderToStaticMarkup(<SystemMailLabelIcon label="Customer" />)).toBe('');
  });
});
