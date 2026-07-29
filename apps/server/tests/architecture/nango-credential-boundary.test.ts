import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const repoRoot = resolve(serverRoot, '../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const listSourceFiles = (relativeDirectory: string): string[] =>
  readdirSync(resolve(repoRoot, relativeDirectory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return listSourceFiles(relativePath);
    return /\.[jt]sx?$/.test(entry.name) ? [relativePath] : [];
  });

describe('Nango frontend credential boundary', () => {
  it('keeps Nango secrets and credential payloads out of the mail frontend', () => {
    for (const relativePath of [
      ...listSourceFiles('apps/mail/app'),
      ...listSourceFiles('apps/mail/components'),
      ...listSourceFiles('apps/mail/hooks'),
      ...listSourceFiles('apps/mail/lib'),
      ...listSourceFiles('apps/mail/providers'),
    ]) {
      const source = read(relativePath);
      for (const forbidden of [
        'NANGO_BASE_URL',
        'NANGO_SECRET_KEY',
        'NANGO_GMAIL_INTEGRATION_KEY',
        'NANGO_OUTLOOK_INTEGRATION_KEY',
        'NANGO_ZOHO_MAIL_INTEGRATION_KEY',
        'NANGO_IMAP_SMTP_INTEGRATION_KEY',
        'access_token',
        'refresh_token',
      ]) {
        expect(
          source.includes(forbidden),
          `${relativePath} exposes the forbidden Nango credential field ${forbidden}`,
        ).toBe(false);
      }
    }
  });

  it('does not persist Nango service configuration in the system config table', () => {
    const schema = read('apps/server/src/db/schema.ts');
    const table = schema.slice(
      schema.indexOf('export const systemIntegrationConfig'),
      schema.indexOf('export const channelConfig'),
    );
    const migration = read('apps/server/src/db/migrations/0000_steady_silver_centurion.sql');
    const migrationTable = migration.slice(
      migration.indexOf('CREATE TABLE "integration"."system_config"'),
      migration.indexOf(
        '--> statement-breakpoint',
        migration.indexOf('CREATE TABLE "integration"."system_config"'),
      ),
    );

    expect(table).not.toContain("'nango'");
    expect(migrationTable).not.toContain("'nango'");
    expect(table).toContain("'gmail_zero_oauth'");
    expect(migrationTable).toContain("'gmail_zero_oauth'");
  });
});
