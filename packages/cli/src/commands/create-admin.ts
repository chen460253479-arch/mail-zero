import { isCancel, log, password, text } from '@clack/prompts';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { getProjectRoot, parseEnv } from '../utils';
import { resolveAdminCliConfig } from './create-admin-config';
import type { Command } from '.';

const requireAnswer = <T>(answer: T | symbol): T => {
  if (isCancel(answer)) {
    log.error('Administrator creation cancelled');
    process.exit(0);
  }
  return answer as T;
};

export const command: Command = {
  id: 'create-admin',
  description: 'Create the one-time local superadmin account',
  run: async () => {
    const root = await getProjectRoot();
    const envContents = await readFile(join(root, '.env'), 'utf8').catch(() => '');
    const environment = Object.fromEntries(
      parseEnv(envContents).map(({ key, value }) => [key, value]),
    );

    const { backendUrl, name, email, password: adminPassword, bootstrapSecret } =
      await resolveAdminCliConfig(environment, {
        backendUrl: async () =>
          requireAnswer(
            await text({
              message: 'Zero backend URL',
              initialValue: 'http://localhost:8787',
              validate: (value) => {
                try {
                  new URL(value);
                } catch {
                  return 'Enter a valid URL';
                }
              },
            }),
          ),
        name: async () =>
          requireAnswer(
            await text({
              message: 'Administrator name',
              initialValue: 'Zero Admin',
              validate: (value) => (value.trim() ? undefined : 'Name is required'),
            }),
          ),
        email: async () =>
          requireAnswer(
            await text({
              message: 'Administrator login email',
              validate: (value) =>
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
                  ? undefined
                  : 'Enter a valid email address',
            }),
          ),
        password: async () => {
          const enteredPassword = requireAnswer(
            await password({
              message: 'Administrator password',
              validate: (value) =>
                value.length >= 12 ? undefined : 'Password must contain at least 12 characters',
            }),
          );
          requireAnswer(
            await password({
              message: 'Confirm administrator password',
              validate: (value) =>
                value === enteredPassword ? undefined : 'Passwords do not match',
            }),
          );
          return enteredPassword;
        },
        bootstrapSecret: async () =>
          requireAnswer(
            await password({
              message: 'Bootstrap secret (ZERO_ADMIN_BOOTSTRAP_SECRET)',
              validate: (value) => (value ? undefined : 'Bootstrap secret is required'),
            }),
          ),
      });

    const response = await fetch(
      `${backendUrl.replace(/\/$/, '')}/api/public/bootstrap-admin`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zero-bootstrap-secret': bootstrapSecret,
        },
        body: JSON.stringify({ name, email, password: adminPassword }),
      },
    );
    const result = (await response.json().catch(() => ({}))) as {
      created?: boolean;
      email?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(result.error || `Administrator creation failed (${response.status})`);
    }

    log.success(
      result.created
        ? `Created local superadmin ${result.email}`
        : `Local superadmin ${result.email} already exists`,
    );
  },
};
