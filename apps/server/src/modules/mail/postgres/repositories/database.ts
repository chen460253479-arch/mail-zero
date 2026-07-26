import { MailCoreError, type MailCoreErrorCode } from '@zero/mail-core';

import type { DB } from '../../../../db';

export type MailDatabase = Pick<DB, 'delete' | 'execute' | 'insert' | 'select' | 'update'>;

const missing = (code: MailCoreErrorCode, entityId?: string): never => {
  throw new MailCoreError(code, entityId === undefined ? {} : { entityId });
};

export const requireRow = <Row>(rows: Row[], code: MailCoreErrorCode, entityId?: string): Row =>
  rows[0] ?? missing(code, entityId);

const driverField = (error: unknown, field: string): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const value = record[field];
  if (typeof value === 'string') {
    return value;
  }
  return driverField(record.cause, field);
};

const errorForConstraint = (constraint: string | undefined): MailCoreErrorCode | null => {
  switch (constraint) {
    case 'mailbox_account_role_active_uidx':
      return 'MAILBOX_ROLE_CONFLICT';
    case 'mailbox_active_sibling_name_uidx':
    case 'mailbox_active_root_name_uidx':
      return 'MAILBOX_NAME_CONFLICT';
    case 'mail_identity_account_default_active_uidx':
      return 'IDENTITY_DEFAULT_CONFLICT';
    case 'email_submission_account_idempotency_uidx':
    case 'remote_email_account_provider_remote_uidx':
      return 'IDEMPOTENCY_CONFLICT';
    case 'submission_attempt_account_submission_number_uidx':
      return 'INVALID_SUBMISSION_TRANSITION';
    case 'blob_account_sha_size_uidx':
      return 'BLOB_INTEGRITY';
    case 'mail_account_connection_user_fk':
      return 'CROSS_ACCOUNT_REFERENCE';
    case 'email_identity_account_fk':
    case 'email_reply_account_fk':
    case 'email_thread_account_fk':
    case 'email_blob_account_fk':
    case 'email_address_email_account_fk':
    case 'email_content_email_account_fk':
    case 'email_content_text_blob_account_fk':
    case 'email_content_html_blob_account_fk':
    case 'email_keyword_email_account_fk':
    case 'email_mailbox_email_account_fk':
    case 'email_mailbox_mailbox_account_fk':
    case 'email_part_email_account_fk':
    case 'email_part_parent_account_fk':
    case 'email_part_blob_account_fk':
    case 'email_trash_restore_email_account_fk':
    case 'email_trash_restore_mailbox_account_fk':
    case 'remote_email_email_account_fk':
    case 'mailbox_parent_account_fk':
    case 'email_search_email_account_fk':
    case 'email_submission_email_account_fk':
    case 'email_submission_identity_account_fk':
    case 'thread_reference_email_account_fk':
    case 'thread_reference_thread_account_fk':
    case 'submission_attempt_submission_account_fk':
    case 'submission_blob_submission_account_fk':
    case 'submission_blob_blob_account_fk':
      return 'CROSS_ACCOUNT_REFERENCE';
    default:
      return null;
  }
};

export const runAdapter = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MailCoreError) {
      throw error;
    }
    const constraint = driverField(error, 'constraint_name') ?? driverField(error, 'constraint');
    const mapped = errorForConstraint(constraint);
    if (mapped !== null) {
      throw new MailCoreError(mapped);
    }
    throw new MailCoreError('STORAGE_FAILURE');
  }
};
