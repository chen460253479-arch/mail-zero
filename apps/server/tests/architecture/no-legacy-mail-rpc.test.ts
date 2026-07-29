import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const srcRoot = resolve(serverRoot, 'src');
const mainSource = readFileSync(resolve(srcRoot, 'main.ts'), 'utf8');
const serverUtilsSource = readFileSync(resolve(srcRoot, 'lib/server-utils.ts'), 'utf8');

describe('local user workspace boundary', () => {
  it('does not retain the Durable Object RPC implementation', () => {
    expect(mainSource).not.toMatch(/\b(?:DurableObject|RpcTarget|DbRpcDO|ZeroDB)\b/u);
    expect(serverUtilsSource).not.toContain('ZERO_DB');
    expect(serverUtilsSource).not.toContain('getZeroDB');
  });

  it('does not import the retired mail-channel registry', () => {
    expect(mainSource).not.toContain('./lib/mail-channel/');
  });
});
