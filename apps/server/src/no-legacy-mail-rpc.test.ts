import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const srcRoot = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(srcRoot, 'main.ts'), 'utf8');

describe('ZeroDB RPC boundary', () => {
  it('does not expose mailbox lifecycle or authorization persistence methods', () => {
    const retiredMethods = [
      'createConnection',
      'createMailboxWithAuthorization',
      'findUserConnection',
      'findConnectionWithAuthorization',
      'findFirstConnection',
      'findManyConnections',
      'findManyConnectionsWithAuthorization',
      'findConnectionByNormalizedEmail',
      'findAuthorizationByNangoReference',
      'deleteConnection',
      'removeAuthorizationBinding',
      'markConnectionDisconnected',
      'markConnectionDeleting',
      'deleteMailbox',
      'findConnectionById',
      'deleteActiveConnection',
      'updateConnection',
    ];

    const violations = retiredMethods.filter((method) =>
      new RegExp(`\\b(?:async\\s+)?${method}\\s*\\(`, 'u').test(mainSource),
    );
    expect(violations).toEqual([]);
  });

  it('does not import the retired mail-channel registry', () => {
    expect(mainSource).not.toContain('./lib/mail-channel/');
  });
});
