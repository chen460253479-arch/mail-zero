import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const testRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(testRoot, '../../../..');
const runtimeRoot = resolve(serverRoot, 'src/runtime/mail');
const readRuntime = (name: string): string => readFileSync(resolve(runtimeRoot, name), 'utf8');

describe('mail outbound runtime', () => {
  it('registers every provider on the shared credential and outbound runtime', () => {
    const credentialContext = readRuntime('gmail-credential-context.ts');
    const channelCredentialContext = readRuntime('channel-credential-context.ts');
    const inbound = readRuntime('gmail-inbound.ts');
    const outbound = readRuntime('outbound.ts');

    expect(channelCredentialContext).toContain("authSource === 'nango'");
    expect(credentialContext).toContain('createMailChannelCredentialContext');
    expect(credentialContext.match(/createCredentialAwareGmailExecutor/gu)).toHaveLength(2);
    expect(inbound).toContain("from './gmail-credential-context'");
    expect(outbound).toContain("from './gmail-credential-context'");
    expect(outbound).toContain("from './channel-credential-context'");
    expect(outbound).toContain('createMailChannelRegistry');
    expect(outbound).toContain('createGmailPlugin');
    expect(outbound).toContain('createOutlookPlugin');
    expect(outbound).toContain('createZohoMailPlugin');
    expect(outbound).toContain('createImapSmtpPluginForEnvironment');
  });

  it('does not depend on the retired driver, pipeline, KV, or legacy send queue', () => {
    const outbound = readRuntime('outbound.ts');
    for (const forbidden of ['lib/driver', 'pipelines', 'KVNamespace', 'send_email_queue']) {
      expect(outbound).not.toContain(forbidden);
    }
  });

  it('uses the process-level database and runtime resources for commands and scans', () => {
    const outbound = readRuntime('outbound.ts');
    expect(outbound).toContain('runMailOutboundCommand = async (\n  db: DB,');
    expect(outbound).toContain('enqueueDueMailOutboundWork = async (\n  db: DB,');
    expect(outbound).not.toContain('createDb(');
    expect(outbound).not.toContain('conn.end(');
  });
});
