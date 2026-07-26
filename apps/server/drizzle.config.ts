import { type Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  out: './src/db/migrations',
  schemaFilter: ['auth', 'app', 'integration', 'mail'],
} satisfies Config;
