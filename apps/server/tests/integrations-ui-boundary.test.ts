import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('administrator integrations UI boundary', () => {
  it('guards the route and hides its navigation item from non-administrators', () => {
    expect(read('apps/mail/app/(routes)/settings/integrations/page.tsx')).toContain(
      'isAdministrator(session)',
    );
    expect(read('apps/mail/config/navigation.ts')).toContain('adminOnly: true');
    expect(read('apps/mail/components/ui/app-sidebar.tsx')).toContain('item.adminOnly');
  });

  it('never renders stored integration secret fields', () => {
    for (const file of [
      'apps/mail/components/integrations/nango-settings-card.tsx',
      'apps/mail/components/integrations/gmail-oauth-settings-card.tsx',
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/encryptedSecret|encryptedPayload|accessToken|refreshToken/);
    }
  });

  it('does not report post-save refresh failures as Nango validation failures', () => {
    const source = read('apps/mail/components/integrations/nango-settings-card.tsx');
    expect(source.indexOf('getNangoValidationErrorMessage(error)')).toBeLessThan(
      source.indexOf('await onChanged()'),
    );
  });
});
