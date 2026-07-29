import { spawnSync } from 'node:child_process';

const image = process.argv[2] ?? 'zero-server';

const runDocker = (args) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `docker ${args.join(' ')} failed`);
  }
  return result.stdout;
};

const [metadata] = JSON.parse(runDocker(['image', 'inspect', image]));
const startup = [...(metadata.Config?.Entrypoint ?? []), ...(metadata.Config?.Cmd ?? [])].join(' ');
if (!startup.includes('zero-server-entrypoint') && !startup.includes('/app/dist/main.js')) {
  throw new Error(`Unexpected Server image startup command: ${startup}`);
}

runDocker([
  'run',
  '--rm',
  '--entrypoint',
  'sh',
  image,
  '-c',
  [
    'test -f /app/dist/main.js',
    'test ! -e /app/src',
    'test -z "$(find /app -type f \\( -name wrangler -o -name workerd \\) -print -quit)"',
  ].join(' && '),
]);

console.log(`${image} is a native Node runtime without Wrangler, workerd, or Server source files.`);
