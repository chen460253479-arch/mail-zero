import { MailCoreError, type MailCoreSetError } from '@zero/mail-core';

import { mapMailCoreError } from '../errors/map-mail-core-error';

export const mapSetError = (error: MailCoreSetError) => {
  const mapped = mapMailCoreError(new MailCoreError(error.code, error.details));
  return { code: mapped.code, details: error.details };
};

export const mapSetErrors = (errors: Record<string, MailCoreSetError>) =>
  Object.fromEntries(Object.entries(errors).map(([id, error]) => [id, mapSetError(error)]));
