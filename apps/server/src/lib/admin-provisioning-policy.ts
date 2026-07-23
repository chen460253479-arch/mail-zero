export type AdminCredentials = {
  name: string;
  email: string;
  password: string;
};

type AdminProvisioningEnv = {
  ZERO_ADMIN_AUTO_PROVISION?: string;
  ZERO_ADMIN_NAME?: string;
  ZERO_ADMIN_EMAIL?: string;
  ZERO_ADMIN_PASSWORD?: string;
};

export const validateAdminCredentials = (credentials: AdminCredentials): AdminCredentials => {
  const normalized = {
    name: credentials.name.trim(),
    email: credentials.email.trim().toLowerCase(),
    password: credentials.password,
  };

  if (!normalized.name) throw new Error('Administrator name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    throw new Error('Administrator email must be a valid email address');
  }
  if (normalized.password.length < 12) {
    throw new Error('Administrator password must contain at least 12 characters');
  }

  return normalized;
};

export const parseAdminProvisioningConfig = (
  environment: AdminProvisioningEnv,
): AdminCredentials | null => {
  if (environment.ZERO_ADMIN_AUTO_PROVISION !== 'true') return null;

  const required = [
    'ZERO_ADMIN_NAME',
    'ZERO_ADMIN_EMAIL',
    'ZERO_ADMIN_PASSWORD',
  ] as const;
  for (const key of required) {
    if (!environment[key]) {
      throw new Error(`${key} is required when ZERO_ADMIN_AUTO_PROVISION=true`);
    }
  }

  return validateAdminCredentials({
    name: environment.ZERO_ADMIN_NAME!,
    email: environment.ZERO_ADMIN_EMAIL!,
    password: environment.ZERO_ADMIN_PASSWORD!,
  });
};
