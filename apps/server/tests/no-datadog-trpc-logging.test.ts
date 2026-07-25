import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');
const listSourceFiles = (relativeDirectory: string): string[] =>
  readdirSync(resolve(repoRoot, relativeDirectory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return listSourceFiles(relativePath);
    return /\.[jt]sx?$/.test(entry.name) ? [relativePath] : [];
  });

describe('third-party tRPC logging boundary', () => {
  it('does not ship the Datadog logging stack or register its tRPC middleware', () => {
    for (const relativePath of [
      'apps/server/src/lib/datadog-service.ts',
      'apps/server/src/lib/logging-service.ts',
      'apps/server/src/lib/trpc-logging.ts',
      'apps/server/src/trpc/routes/logging.ts',
      'apps/server/src/types/logging.ts',
    ]) {
      expect(existsSync(resolve(repoRoot, relativePath)), relativePath).toBe(false);
    }

    for (const relativePath of listSourceFiles('apps/server/src')) {
      expect(read(relativePath), relativePath).not.toMatch(
        /\bDatadog\b|@datadog\/|DD_API_KEY|DD_APP_KEY|DD_SITE/i,
      );
    }

    expect(read('apps/server/package.json')).not.toContain('@datadog/datadog-api-client');
    expect(read('pnpm-lock.yaml')).not.toContain('@datadog/datadog-api-client');
    expect(read('apps/server/src/env.ts')).not.toMatch(/\bDD_(API_KEY|APP_KEY|SITE)\b/);
    expect(read('apps/server/wrangler.jsonc')).not.toMatch(/\bDD_(API_KEY|APP_KEY|SITE)\b/);
    expect(read('apps/server/src/trpc/trpc.ts')).not.toContain('createLoggingMiddleware');
    expect(read('apps/server/src/trpc/index.ts')).not.toContain('loggingRouter');
  });

  it('keeps the internal request trace implementation available', () => {
    expect(existsSync(resolve(repoRoot, 'apps/server/src/lib/trace-context.ts'))).toBe(true);
    expect(read('apps/server/src/trpc/trpc.ts')).toContain("import('../lib/trace-context')");
    expect(read('apps/server/src/main.ts')).toContain('finalizeRequestTrace');
  });
});
