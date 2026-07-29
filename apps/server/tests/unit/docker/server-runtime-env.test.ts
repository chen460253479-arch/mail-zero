import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const testRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testRoot, '../../../../..');
const scriptPath = resolve(repoRoot, 'docker/server/write-runtime-env.mjs');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Server runtime environment writer', () => {
  it('writes only whitelisted variables without exposing their values', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'zero-server-env-'));
    temporaryDirectories.push(temporaryDirectory);
    const outputPath = join(temporaryDirectory, 'runtime', 'server.env');

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ZERO_RUNTIME_ENV_PATH: outputPath,
        DATABASE_URL: 'postgresql://user:p#ss@db:5432/zero',
        NANGO_SECRET_KEY: 'secret "quoted" value',
        UNRELATED_HOST_SECRET: 'must-not-be-written',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');

    const runtimeEnvironment = readFileSync(outputPath, 'utf8');
    expect(runtimeEnvironment).toContain(
      `DATABASE_URL=${JSON.stringify('postgresql://user:p#ss@db:5432/zero')}`,
    );
    expect(runtimeEnvironment).toContain(
      `NANGO_SECRET_KEY=${JSON.stringify('secret "quoted" value')}`,
    );
    expect(runtimeEnvironment).not.toContain('UNRELATED_HOST_SECRET');

    if (process.platform !== 'win32') {
      expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    }
  });
});
