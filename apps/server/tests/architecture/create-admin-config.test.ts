import { describe, expect, it, vi } from 'vitest';

import { resolveAdminCliConfig } from '../../../../packages/cli/src/commands/create-admin-config';

const completeEnvironment = {
  VITE_PUBLIC_BACKEND_URL: 'http://localhost:8787',
  ZERO_ADMIN_NAME: 'Zero Admin',
  ZERO_ADMIN_EMAIL: 'admin@example.com',
  ZERO_ADMIN_PASSWORD: 'correct horse battery staple',
  ZERO_ADMIN_BOOTSTRAP_SECRET: 'local-bootstrap-secret',
};

describe('resolveAdminCliConfig', () => {
  it('uses a complete environment without prompting', async () => {
    const prompt = vi.fn(async () => {
      throw new Error('prompt should not be called');
    });

    await expect(
      resolveAdminCliConfig(completeEnvironment, {
        backendUrl: prompt,
        name: prompt,
        email: prompt,
        password: prompt,
        bootstrapSecret: prompt,
      }),
    ).resolves.toEqual({
      backendUrl: 'http://localhost:8787',
      name: 'Zero Admin',
      email: 'admin@example.com',
      password: 'correct horse battery staple',
      bootstrapSecret: 'local-bootstrap-secret',
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('prompts only for missing or invalid values', async () => {
    const passwordPrompt = vi.fn(async () => 'replacement password');
    const bootstrapPrompt = vi.fn(async () => 'replacement secret');
    const unusedPrompt = vi.fn(async () => {
      throw new Error('configured value should be used');
    });

    const result = await resolveAdminCliConfig(
      {
        ...completeEnvironment,
        ZERO_ADMIN_PASSWORD: 'short',
        ZERO_ADMIN_BOOTSTRAP_SECRET: '',
      },
      {
        backendUrl: unusedPrompt,
        name: unusedPrompt,
        email: unusedPrompt,
        password: passwordPrompt,
        bootstrapSecret: bootstrapPrompt,
      },
    );

    expect(result.password).toBe('replacement password');
    expect(result.bootstrapSecret).toBe('replacement secret');
    expect(passwordPrompt).toHaveBeenCalledOnce();
    expect(bootstrapPrompt).toHaveBeenCalledOnce();
    expect(unusedPrompt).not.toHaveBeenCalled();
  });
});
