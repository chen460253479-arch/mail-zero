import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./gmail-settings-dialog.tsx', import.meta.url), 'utf8');

describe('Gmail settings dialog close flow', () => {
  it('bypasses the unsaved-changes guard after a successful save', () => {
    const saveFlow = source.slice(
      source.indexOf('const save = async () => {'),
      source.indexOf('const validateGmailOAuth = async () => {'),
    );

    expect(saveFlow).toContain('onOpenChange(false);');
    expect(saveFlow).not.toContain('requestClose(false);');
  });
});
