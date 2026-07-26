import type { DestroyDraftInput, DestroyDraftResult } from './draft-types';
import { destroyEmailInTransaction } from './destroy-email';
import type { MailCoreDependencies } from '../store';
import { MailCoreError } from '../types';

export async function destroyDraft(
  dependencies: MailCoreDependencies,
  input: DestroyDraftInput,
): Promise<DestroyDraftResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const email = await tx.emails.findById(input.accountId, input.emailId);
    if (email === null) {
      throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
    }
    if (email.lifecycle !== 'draft') {
      throw new MailCoreError('EMAIL_CONTENT_IMMUTABLE', { entityId: input.emailId });
    }
    return destroyEmailInTransaction(dependencies, tx, input);
  });
}
