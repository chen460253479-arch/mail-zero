import { describe, expect, it } from 'vitest';

import { shouldShowIconActionTooltip } from './icon-action-tooltip';

describe('shouldShowIconActionTooltip', () => {
  it('shows a tooltip when the action has no visible text label', () => {
    expect(shouldShowIconActionTooltip()).toBe(true);
  });

  it('does not duplicate the tooltip when the action already has a text label', () => {
    expect(shouldShowIconActionTooltip('Move')).toBe(false);
  });
});
