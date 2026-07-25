import { pgTableCreator } from 'drizzle-orm/pg-core';

export const createMailTable = pgTableCreator((name) => `mail0_${name}`);
