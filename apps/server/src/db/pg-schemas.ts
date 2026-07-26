import { pgSchema } from 'drizzle-orm/pg-core';

export const BUSINESS_SCHEMA_NAMES = ['auth', 'app', 'integration', 'mail'] as const;

export const authSchema = pgSchema('auth');
export const appSchema = pgSchema('app');
export const integrationSchema = pgSchema('integration');
export const mailSchema = pgSchema('mail');
