import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const runtimeVariableNames = [
  'NODE_ENV',
  'JWT_SECRET',
  'BASE_URL',
  'VITE_PUBLIC_APP_URL',
  'VITE_PUBLIC_BACKEND_URL',
  'DATABASE_URL',
  'CREDENTIAL_ENCRYPTION_KEY',
  'NANGO_BASE_URL',
  'NANGO_SECRET_KEY',
  'NANGO_GMAIL_INTEGRATION_KEY',
  'NANGO_OUTLOOK_INTEGRATION_KEY',
  'NANGO_ZOHO_MAIL_INTEGRATION_KEY',
  'NANGO_IMAP_SMTP_INTEGRATION_KEY',
  'MAIL_PROTOCOL_WORKER_URL',
  'MAIL_PROTOCOL_WORKER_SECRET',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'RESEND_API_KEY',
  'COOKIE_DOMAIN',
  'BETTER_AUTH_TRUSTED_ORIGINS',
  'ZERO_ADMIN_AUTO_PROVISION',
  'ZERO_ADMIN_NAME',
  'ZERO_ADMIN_EMAIL',
  'ZERO_ADMIN_PASSWORD',
  'ZERO_ADMIN_BOOTSTRAP_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'REDIS_URL',
  'REDIS_TOKEN',
  'EARLY_ACCESS_ENABLED',
  'DEV_PROXY',
  'MEET_AUTH_HEADER',
  'MEET_API_URL',
  'ENABLE_MEET',
];

const outputPath = process.env.ZERO_RUNTIME_ENV_PATH ?? '/run/zero/server.env';
const outputDirectory = dirname(outputPath);
const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
const lines = [];

for (const name of runtimeVariableNames) {
  const value = process.env[name];
  if (value !== undefined) {
    lines.push(`${name}=${JSON.stringify(value)}`);
  }
}

mkdirSync(outputDirectory, { recursive: true });

try {
  writeFileSync(temporaryPath, `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, outputPath);
} catch (error) {
  try {
    unlinkSync(temporaryPath);
  } catch {
    // The temporary file may not have been created.
  }
  throw error;
}
