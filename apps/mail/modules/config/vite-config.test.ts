import type { ConfigEnv, Plugin, UserConfig, UserConfigExport } from 'vite';
import { describe, expect, it } from 'vitest';

import viteConfig from '../../vite.config';

const resolveConfig = async (
  exportedConfig: UserConfigExport,
  command: ConfigEnv['command'],
): Promise<UserConfig> => {
  const config =
    typeof exportedConfig === 'function'
      ? exportedConfig({
          command,
          isPreview: false,
          isSsrBuild: false,
          mode: 'test',
        })
      : exportedConfig;

  return await config;
};

const pluginNames = (config: UserConfig) =>
  (config.plugins ?? [])
    .flatMap((plugin) => (Array.isArray(plugin) ? plugin : [plugin]))
    .filter(
      (plugin): plugin is Plugin =>
        typeof plugin === 'object' && plugin !== null && 'name' in plugin,
    )
    .map((plugin) => plugin.name);

describe('Mail Vite config', () => {
  it('runs Oxlint while serving the development application', async () => {
    expect(pluginNames(await resolveConfig(viteConfig, 'serve'))).toContain('vite-plugin-oxlint');
  });

  it('does not run the development linter during a production build', async () => {
    expect(pluginNames(await resolveConfig(viteConfig, 'build'))).not.toContain(
      'vite-plugin-oxlint',
    );
  });
});
