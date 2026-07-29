import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(resolve(import.meta.dirname, '../../src', path), 'utf8');

describe('external session permission architecture', () => {
  it('keeps destructive connection operations on privateProcedure', () => {
    const connections = source('trpc/routes/connections.ts');

    expect(connections).toMatch(/bindNango:\s*privateProcedure/u);
    expect(connections).toMatch(/disconnect:\s*privateProcedure/u);
    expect(connections).toMatch(/deleteRetainedData:\s*privateProcedure/u);
    expect(connections).toMatch(/bindManualImapSmtp:\s*privateProcedure/u);
  });

  it('does not turn an external session into a Better Auth user', () => {
    const application = source('runtime/node/application.ts');

    expect(application).toContain("c.set('externalSession', externalSession ?? undefined)");
    expect(application).not.toMatch(/c\.set\('sessionUser',\s*externalSession/u);
  });

  it('exposes no grant scopes or tokens from externalAccess.current', () => {
    const router = source('modules/external-integration/trpc/router.ts');

    expect(router).toContain("mode: 'external'");
    expect(router).toContain('sessionId: ctx.externalSession.id');
    expect(router).not.toContain('sessionToken');
    expect(router).not.toContain('allowedNangoConnectIds');
    expect(router).not.toContain('scopes:');
  });
});
