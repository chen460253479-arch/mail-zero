import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');

describe('authentication session cleanup', () => {
  it('signs out the current session without calling the token-based revoke API', () => {
    const source = readFileSync(resolve(serverRoot, 'src/lib/server-utils.ts'), 'utf8');

    expect(source).toContain('auth.api.signOut({ headers: c.req.raw.headers })');
    expect(source).not.toContain('auth.api.revokeSession(');
  });
});
