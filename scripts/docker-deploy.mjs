import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const usage = '用法: pnpm docker:deploy <mail|server>';
const supportedServices = new Set(['mail', 'server']);

export const createDockerDeployPlan = (args) => {
  if (args.length !== 1 || !supportedServices.has(args[0])) {
    throw new Error(usage);
  }

  const service = args[0];
  return [
    [
      'compose',
      'up',
      '--detach',
      '--build',
      '--no-deps',
      '--wait',
      '--wait-timeout',
      '180',
      service,
    ],
    ['compose', 'ps', service],
  ];
};

const run = (args) => {
  const result = spawnSync('docker', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    for (const command of createDockerDeployPlan(process.argv.slice(2))) {
      const status = run(command);
      if (status !== 0) {
        process.exitCode = status;
        break;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : usage);
    process.exitCode = 1;
  }
}
