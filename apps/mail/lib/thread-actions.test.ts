import { describe, expect, it } from 'vitest';

import { getArchiveToggleDestination, getImportantToggleAction } from './thread-actions';

describe('getArchiveToggleDestination', () => {
  it('moves archived threads back to the inbox', () => {
    expect(getArchiveToggleDestination('archive')).toBe('inbox');
  });

  it('archives threads from the inbox', () => {
    expect(getArchiveToggleDestination('inbox')).toBe('archive');
  });
});

describe('getImportantToggleAction', () => {
  it('removes the important marker from an important thread', () => {
    expect(getImportantToggleAction(true)).toEqual({
      important: false,
      label: 'removeFromImportant',
    });
  });

  it('marks an unimportant thread as important', () => {
    expect(getImportantToggleAction(false)).toEqual({
      important: true,
      label: 'markAsImportant',
    });
  });
});
