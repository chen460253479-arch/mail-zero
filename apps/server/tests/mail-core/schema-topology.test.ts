import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { appSchema, authSchema, integrationSchema, mailSchema } from '../../src/db/pg-schemas';
import { expectedLocations } from './helpers/schema-contract';
import * as databaseSchema from '../../src/db/schema';

describe('database business schema topology', () => {
  it('exports schema declarations through the Drizzle entrypoint used by db:push', () => {
    expect(databaseSchema.authSchema).toBe(authSchema);
    expect(databaseSchema.appSchema).toBe(appSchema);
    expect(databaseSchema.integrationSchema).toBe(integrationSchema);
    expect(databaseSchema.mailSchema).toBe(mailSchema);
  });

  it('assigns every table to its business schema without project prefixes', () => {
    for (const [exportName, table, expectedSchema, expectedName] of expectedLocations) {
      const config = getTableConfig(table);
      expect(config.schema, exportName).toBe(expectedSchema);
      expect(config.name, exportName).toBe(expectedName);
      expect(config.name, exportName).not.toMatch(/^mail0_/u);
    }
  });
});
