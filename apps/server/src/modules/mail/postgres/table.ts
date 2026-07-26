import { integrationSchema, mailSchema } from '../../../db/pg-schemas';

export const createMailTable = mailSchema.table;
export const createIntegrationTable = integrationSchema.table;
