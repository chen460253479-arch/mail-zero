import type { ZeroDB } from './main';

import { env as _env } from 'cloudflare:workers';

export type ZeroEnv = {
  ZERO_DB: DurableObjectNamespace<ZeroDB>;
  HYPERDRIVE: { connectionString: string };
  MAIL_INGRESS_QUEUE: Queue;
  MAIL_OUTBOUND_QUEUE: Queue;
  NODE_ENV: 'local' | 'development' | 'production';
  JWT_SECRET: 'secret';
  BASE_URL: string;
  VITE_PUBLIC_APP_URL: string;
  DATABASE_URL: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  NANGO_BASE_URL?: string;
  NANGO_SECRET_KEY?: string;
  NANGO_GMAIL_INTEGRATION_KEY?: string;
  NANGO_OUTLOOK_INTEGRATION_KEY?: string;
  NANGO_ZOHO_MAIL_INTEGRATION_KEY?: string;
  NANGO_IMAP_SMTP_INTEGRATION_KEY?: string;
  MAIL_PROTOCOL_WORKER_URL?: string;
  MAIL_PROTOCOL_WORKER_SECRET?: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  RESEND_API_KEY: string;
  COOKIE_DOMAIN: string;
  BETTER_AUTH_TRUSTED_ORIGINS: string;
  ZERO_ADMIN_AUTO_PROVISION?: 'true' | 'false';
  ZERO_ADMIN_NAME?: string;
  ZERO_ADMIN_EMAIL?: string;
  ZERO_ADMIN_PASSWORD?: string;
  ZERO_ADMIN_BOOTSTRAP_SECRET?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  VITE_PUBLIC_BACKEND_URL: string;
  REDIS_URL: string;
  REDIS_TOKEN: string;
  EARLY_ACCESS_ENABLED: string;
  THREADS_BUCKET: R2Bucket;
  DEV_PROXY: string;
  MEET_AUTH_HEADER: string;
  MEET_API_URL: string;
  ENABLE_MEET: 'true' | 'false';
};

const env = _env as unknown as ZeroEnv;
export { env };
