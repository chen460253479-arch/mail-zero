type SubmissionSetContext = {
  accountId: string;
  state?: string;
};

export function buildSubmissionCreateInput({
  accountId,
  state,
  clientId,
  emailId,
  identityId,
  idempotencyKey,
  scheduleAt,
  now = new Date(),
  undoWindowMs,
}: SubmissionSetContext & {
  clientId: string;
  emailId: string;
  identityId: string;
  idempotencyKey: string;
  scheduleAt?: string;
  now?: Date;
  undoWindowMs: number;
}) {
  const sendAt = scheduleAt ?? new Date(now.getTime() + undoWindowMs).toISOString();
  return {
    accountId,
    ...(state ? { ifInState: state } : {}),
    create: {
      [clientId]: {
        emailId,
        identityId,
        sendAt,
        idempotencyKey,
      },
    },
    destroy: [] as string[],
  };
}

export function buildCancelSubmissionInput({
  accountId,
  state,
  submissionId,
}: SubmissionSetContext & {
  submissionId: string;
}) {
  return {
    accountId,
    ...(state ? { ifInState: state } : {}),
    create: {},
    destroy: [submissionId],
  };
}
