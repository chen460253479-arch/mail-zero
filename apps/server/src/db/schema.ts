export * from './core-schema';
export * from '../modules/mail/postgres/schema';
export * from '../modules/mail-sync/postgres/schema';
export * from '../modules/mail-outbound/postgres/schema';
export * from '../modules/mail-snooze/postgres/schema';
export * from '../modules/mail-tasks/postgres/schema';
export { appSchema, authSchema, integrationSchema, mailSchema } from './pg-schemas';
