export type SubmissionStatus = 'scheduled' | 'queued' | 'sent' | 'failed' | 'canceled';

export type Submission = {
  id: string;
  emailId: string;
  identityId: string;
  status: SubmissionStatus;
  sendAt: string;
  draftRevision: number;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};
