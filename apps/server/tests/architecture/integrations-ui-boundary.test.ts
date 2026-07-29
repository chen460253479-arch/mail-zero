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

  it('exposes only the Gmail Pub/Sub topic as editable Inbox Watch configuration', () => {
    const source = [
      read('apps/mail/components/integrations/gmail-settings-dialog.tsx'),
      read('apps/mail/modules/integrations/gmail-config.ts'),
    ].join('\n');

    for (const forbidden of [
      'subscriptionName',
      'pushAudience',
      'pushServiceAccount',
      'Subscription name',
      'OIDC audience',
      'Push service account',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('clears the dirty guard before closing after a successful Gmail save refresh', () => {
    const source = read('apps/mail/components/integrations/gmail-settings-dialog.tsx');
    const saveStart = source.indexOf('const save = async () => {');
    const saveEnd = source.indexOf('const validateGmailOAuth', saveStart);
    const saveSource = source.slice(saveStart, saveEnd);
    const catchStart = saveSource.indexOf('} catch {');
    const successSource = saveSource.slice(0, catchStart);
    const failureSource = saveSource.slice(catchStart);

    expect(saveStart).toBeGreaterThanOrEqual(0);
    expect(saveEnd).toBeGreaterThan(saveStart);
    expect(catchStart).toBeGreaterThanOrEqual(0);
    expect(successSource).toContain('await refresh()');
    expect(successSource.indexOf('await refresh()')).toBeLessThan(
      successSource.indexOf('dirtyRef.current = false'),
    );
    expect(successSource.indexOf('dirtyRef.current = false')).toBeLessThan(
      successSource.indexOf('requestClose(false)'),
    );
    expect(successSource).not.toContain('onOpenChange(false)');
    expect(failureSource).not.toContain('requestClose(false)');
  });

  it('waits for the latest Gmail configuration to hydrate before rendering the form', () => {
    const source = read('apps/mail/components/integrations/gmail-settings-dialog.tsx');

    expect(source).toContain('hydratedConfigUpdatedAt');
    expect(source).toContain('setHydratedConfigUpdatedAt(config.dataUpdatedAt)');
    expect(source).toContain('config.isFetching');
    expect(source).toContain('hydratedConfigUpdatedAt !== config.dataUpdatedAt');
  });
});
