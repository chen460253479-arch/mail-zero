import { MailCoreError, type EmailId, type MailAccountId } from '../types';
import type { EmailRecord, MailCoreDependencies } from '../store';

export type GetEmailInput = {
  accountId: MailAccountId;
  emailId: EmailId;
};

export async function getEmail(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: GetEmailInput,
): Promise<EmailRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    if ((await tx.accounts.findById(input.accountId)) === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    const email = await tx.emails.findById(input.accountId, input.emailId);
    if (email === null || email.destroyedAt !== null) {
      if (await tx.emails.existsOutsideAccount(input.accountId, input.emailId)) {
        throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: input.emailId });
      }
      throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
    }
    return email;
  });
}
