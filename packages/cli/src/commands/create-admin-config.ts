export type AdminCliConfig = {
  backendUrl: string;
  name: string;
  email: string;
  password: string;
  bootstrapSecret: string;
};

type AdminCliEnvironment = Partial<
  Record<
    | 'VITE_PUBLIC_BACKEND_URL'
    | 'ZERO_ADMIN_NAME'
    | 'ZERO_ADMIN_EMAIL'
    | 'ZERO_ADMIN_PASSWORD'
    | 'ZERO_ADMIN_BOOTSTRAP_SECRET',
    string
  >
>;

type AdminCliPrompts = {
  backendUrl: () => Promise<string>;
  name: () => Promise<string>;
  email: () => Promise<string>;
  password: () => Promise<string>;
  bootstrapSecret: () => Promise<string>;
};

export const resolveAdminCliConfig = async (
  environment: AdminCliEnvironment,
  prompts: AdminCliPrompts,
): Promise<AdminCliConfig> => {
  const configuredBackendUrl = environment.VITE_PUBLIC_BACKEND_URL?.trim();
  const backendUrlIsValid = (() => {
    if (!configuredBackendUrl) return false;
    try {
      new URL(configuredBackendUrl);
      return true;
    } catch {
      return false;
    }
  })();
  const configuredName = environment.ZERO_ADMIN_NAME?.trim();
  const configuredEmail = environment.ZERO_ADMIN_EMAIL?.trim().toLowerCase();
  const configuredPassword = environment.ZERO_ADMIN_PASSWORD;
  const configuredBootstrapSecret = environment.ZERO_ADMIN_BOOTSTRAP_SECRET?.trim();

  return {
    backendUrl: backendUrlIsValid ? configuredBackendUrl! : await prompts.backendUrl(),
    name: configuredName || (await prompts.name()),
    email:
      configuredEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail)
        ? configuredEmail
        : await prompts.email(),
    password:
      configuredPassword && configuredPassword.length >= 12
        ? configuredPassword
        : await prompts.password(),
    bootstrapSecret: configuredBootstrapSecret || (await prompts.bootstrapSecret()),
  };
};
