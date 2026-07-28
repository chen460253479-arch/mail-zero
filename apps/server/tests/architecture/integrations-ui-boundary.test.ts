import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('administrator integrations UI boundary', () => {
  it('hides its navigation item from non-administrators', () => {
    expect(read('apps/mail/config/navigation.ts')).toContain('adminOnly: true');
    expect(read('apps/mail/components/ui/app-sidebar.tsx')).toContain('item.adminOnly');
  });

  it('keeps Nango service credentials and configuration mutations out of the UI', () => {
    const source = read('apps/mail/components/integrations/gmail-settings-dialog.tsx');

    for (const forbidden of [
      'nangoBaseUrl',
      'nangoSecret',
      'validateAndSaveNango',
      'deleteNango',
      'getNangoValidationErrorMessage',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps the Nango Integration mapping controls in the Gmail dialog', () => {
    const source = read('apps/mail/components/integrations/gmail-settings-dialog.tsx');

    expect(source).toContain('listNangoGmailIntegrations');
    expect(source).toContain('setNangoGmailIntegration');
    expect(source).toContain('gmailIntegrationId');
  });

  it('polls only the safe runtime status while startup validation is pending', () => {
    const source = read('apps/mail/components/integrations/gmail-settings-dialog.tsx');

    expect(source).toContain('refetchInterval');
    expect(source).toContain("nango.state === 'validating'");
  });
});
