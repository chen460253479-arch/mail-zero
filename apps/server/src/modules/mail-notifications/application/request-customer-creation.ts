import { MailApiError } from '../../mail-api/errors/mail-api-error';

export type CustomerCreationInspection =
  | 'ready'
  | 'not-found'
  | 'not-received'
  | 'already-marked';

export interface ManualCustomerCreationRepository {
  inspect(input: { accountId: string; messageId: string }): Promise<CustomerCreationInspection>;
  enqueue(input: {
    eventId: string;
    accountId: string;
    messageId: string;
    kind: 'received';
    createCustomerIfMissing: true;
    createdAt: Date;
  }): Promise<boolean>;
}

export type CustomerCreationRequestResult =
  | { status: 'accepted'; eventId: string }
  | { status: 'alreadyMarked'; eventId: null };

type CustomerCreationRequestDependencies = {
  repository: ManualCustomerCreationRepository;
  webhookEnabled: boolean;
  newEventId(): string;
  clock: { now(): Date };
};

const failure = (code: 'INVALID_ARGUMENTS' | 'NOT_FOUND' | 'STORAGE_FAILURE') =>
  new MailApiError({
    code,
    retryable: code === 'STORAGE_FAILURE',
    requestId: crypto.randomUUID(),
  });

export const createCustomerCreationRequestService = (
  dependencies: CustomerCreationRequestDependencies,
) => ({
  request: async (input: {
    accountId: string;
    messageId: string;
  }): Promise<CustomerCreationRequestResult> => {
    if (!dependencies.webhookEnabled) throw failure('STORAGE_FAILURE');

    const inspection = await dependencies.repository.inspect(input);
    if (inspection === 'already-marked') {
      return { status: 'alreadyMarked', eventId: null };
    }
    if (inspection === 'not-found') throw failure('NOT_FOUND');
    if (inspection === 'not-received') throw failure('INVALID_ARGUMENTS');

    const eventId = dependencies.newEventId();
    const inserted = await dependencies.repository.enqueue({
      ...input,
      eventId,
      kind: 'received',
      createCustomerIfMissing: true,
      createdAt: dependencies.clock.now(),
    });
    if (!inserted) throw failure('NOT_FOUND');

    return { status: 'accepted', eventId };
  },
});
