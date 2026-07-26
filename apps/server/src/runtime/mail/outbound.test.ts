import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const runtimeRoot = dirname(fileURLToPath(import.meta.url));
const readRuntime = (name: string): string => readFileSync(resolve(runtimeRoot, name), 'utf8');

describe('mail outbound Worker runtime', () => {
  it('shares one Gmail credential context between Zero OAuth, Nango, inbound, and outbound', () => {
    const credentialContext = readRuntime('gmail-credential-context.ts');
    const inbound = readRuntime('gmail-inbound.ts');
    const outbound = readRuntime('outbound.ts');

    expect(credentialContext).toContain("authSource === 'zero_oauth'");
    expect(credentialContext).toContain("authSource === 'nango'");
    expect(credentialContext.match(/createCredentialAwareGmailExecutor/gu)).toHaveLength(2);
    expect(inbound).toContain("from './gmail-credential-context'");
    expect(outbound).toContain("from './gmail-credential-context'");
    expect(outbound).toContain('createMailChannelRegistry');
    expect(outbound).toContain('createGmailPlugin');
  });

  it('does not depend on the retired driver, pipeline, KV, or legacy send queue', () => {
    const outbound = readRuntime('outbound.ts');
    for (const forbidden of ['lib/driver', 'pipelines', 'KVNamespace', 'send_email_queue']) {
      expect(outbound).not.toContain(forbidden);
    }
  });

  it('closes each command and scheduled database connection in finally', () => {
    const outbound = readRuntime('outbound.ts');
    expect(outbound.match(/finally \{\s*await conn\.end\(\);/gu)).toHaveLength(2);
  });
});
