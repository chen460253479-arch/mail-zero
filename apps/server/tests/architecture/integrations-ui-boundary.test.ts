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

  it('does not expose fixed Nango channel Integration keys as user-selectable mappings', () => {
    const sources = [
      read('apps/mail/components/integrations/gmail-settings-dialog.tsx'),
      read('apps/mail/components/integrations/managed-channel-settings-dialog.tsx'),
    ];

    for (const source of sources) {
      for (const forbidden of [
        'listNangoGmailIntegrations',
        'setNangoGmailIntegration',
        'listNangoIntegrations',
        'setNangoIntegration',
        'gmailIntegrationId',
        'authorizationSources.nango.integrationId',
        'Select a Gmail Integration',
        'Select an Integration',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it('does not poll for the removed Nango validating state', () => {
    const sources = [
      read('apps/mail/components/integrations/gmail-settings-dialog.tsx'),
      read('apps/mail/components/integrations/managed-channel-settings-dialog.tsx'),
    ];

    for (const source of sources) {
      expect(source).not.toContain("nango.state === 'validating'");
    }
  });
});
