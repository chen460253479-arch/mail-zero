import { describe, expect, it } from 'vitest';

import { collectStructuralSchemaShape } from '../../helpers/mail-core/schema-contract';

describe('database structural parity', () => {
  it('preserves every field, constraint, index, and foreign-key semantic', () => {
    expect(collectStructuralSchemaShape()).toMatchSnapshot();
  });
});
