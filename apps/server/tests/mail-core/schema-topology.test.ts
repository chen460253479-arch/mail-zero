import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { expectedLocations } from './helpers/schema-contract';

describe('database business schema topology', () => {
  it('assigns every table to its business schema without project prefixes', () => {
    for (const [exportName, table, expectedSchema, expectedName] of expectedLocations) {
      const config = getTableConfig(table);
      expect(config.schema, exportName).toBe(expectedSchema);
      expect(config.name, exportName).toBe(expectedName);
      expect(config.name, exportName).not.toMatch(/^mail0_/u);
    }
  });
});
