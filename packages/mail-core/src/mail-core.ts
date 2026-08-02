import {
  createDraft,
  destroyDraft,
  destroyEmail,
  getEmail,
  getEmails,
  importEmail,
  queryEmails,
  readEmailPart,
  readEmailPartById,
  setEmails,
  updateDraft,
  updateEmail,
} from './message';
import {
  createIdentity,
  createMailAccount,
  destroyIdentity,
  getMailAccount,
  listIdentities,
  listMailAccounts,
  setIdentities,
  updateIdentity,
} from './account';
import {
  cancelSubmission,
  createSubmission,
  finalizeSubmissionSent,
  getSubmission,
  querySubmissions,
} from './submission';
import {
  createMailbox,
  destroyMailbox,
  listMailboxes,
  setMailboxes,
  updateMailbox,
} from './mailbox';
import { getThread, moveThreadEmails, queryThreads, updateThreadEmails } from './thread';
import { getBlob, readBlob, readBlobRange, uploadBlob } from './blob';
import type { MailCoreDependencies } from './store';
import { getChanges, getState } from './changes';

type BoundCommand<Command extends (...arguments_: never[]) => unknown> = (
  input: Parameters<Command>[1],
) => ReturnType<Command>;

export type MailCore = {
  createAccount: BoundCommand<typeof createMailAccount>;
  listAccounts: BoundCommand<typeof listMailAccounts>;
  getAccount: BoundCommand<typeof getMailAccount>;
  createIdentity: BoundCommand<typeof createIdentity>;
  listIdentities: BoundCommand<typeof listIdentities>;
  setIdentities: BoundCommand<typeof setIdentities>;
  updateIdentity: BoundCommand<typeof updateIdentity>;
  destroyIdentity: BoundCommand<typeof destroyIdentity>;
  createMailbox: BoundCommand<typeof createMailbox>;
  updateMailbox: BoundCommand<typeof updateMailbox>;
  destroyMailbox: BoundCommand<typeof destroyMailbox>;
  listMailboxes: BoundCommand<typeof listMailboxes>;
  setMailboxes: BoundCommand<typeof setMailboxes>;
  importEmail: BoundCommand<typeof importEmail>;
  readEmailPart: BoundCommand<typeof readEmailPart>;
  readEmailPartById: BoundCommand<typeof readEmailPartById>;
  getEmail: BoundCommand<typeof getEmail>;
  getEmails: BoundCommand<typeof getEmails>;
  queryEmails: BoundCommand<typeof queryEmails>;
  setEmails: BoundCommand<typeof setEmails>;
  updateEmail: BoundCommand<typeof updateEmail>;
  destroyEmail: BoundCommand<typeof destroyEmail>;
  createDraft: BoundCommand<typeof createDraft>;
  updateDraft: BoundCommand<typeof updateDraft>;
  destroyDraft: BoundCommand<typeof destroyDraft>;
  createSubmission: BoundCommand<typeof createSubmission>;
  getSubmission: BoundCommand<typeof getSubmission>;
  querySubmissions: BoundCommand<typeof querySubmissions>;
  finalizeSubmissionSent: BoundCommand<typeof finalizeSubmissionSent>;
  cancelSubmission: BoundCommand<typeof cancelSubmission>;
  getThread: BoundCommand<typeof getThread>;
  queryThreads: BoundCommand<typeof queryThreads>;
  updateThreadEmails: BoundCommand<typeof updateThreadEmails>;
  moveThreadEmails: BoundCommand<typeof moveThreadEmails>;
  getChanges: BoundCommand<typeof getChanges>;
  getState: BoundCommand<typeof getState>;
  uploadBlob: BoundCommand<typeof uploadBlob>;
  getBlob: BoundCommand<typeof getBlob>;
  readBlob: BoundCommand<typeof readBlob>;
  readBlobRange: BoundCommand<typeof readBlobRange>;
};

export const createMailCore = (dependencies: MailCoreDependencies): MailCore => ({
  createAccount: (input) => createMailAccount(dependencies, input),
  listAccounts: (input) => listMailAccounts(dependencies, input),
  getAccount: (input) => getMailAccount(dependencies, input),
  createIdentity: (input) => createIdentity(dependencies, input),
  listIdentities: (input) => listIdentities(dependencies, input),
  setIdentities: (input) => setIdentities(dependencies, input),
  updateIdentity: (input) => updateIdentity(dependencies, input),
  destroyIdentity: (input) => destroyIdentity(dependencies, input),
  createMailbox: (input) => createMailbox(dependencies, input),
  updateMailbox: (input) => updateMailbox(dependencies, input),
  destroyMailbox: (input) => destroyMailbox(dependencies, input),
  listMailboxes: (input) => listMailboxes(dependencies, input),
  setMailboxes: (input) => setMailboxes(dependencies, input),
  importEmail: (input) => importEmail(dependencies, input),
  readEmailPart: (input) => readEmailPart(dependencies, input),
  readEmailPartById: (input) => readEmailPartById(dependencies, input),
  getEmail: (input) => getEmail(dependencies, input),
  getEmails: (input) => getEmails(dependencies, input),
  queryEmails: (input) => queryEmails(dependencies, input),
  setEmails: (input) => setEmails(dependencies, input),
  updateEmail: (input) => updateEmail(dependencies, input),
  destroyEmail: (input) => destroyEmail(dependencies, input),
  createDraft: (input) => createDraft(dependencies, input),
  updateDraft: (input) => updateDraft(dependencies, input),
  destroyDraft: (input) => destroyDraft(dependencies, input),
  createSubmission: (input) => createSubmission(dependencies, input),
  getSubmission: (input) => getSubmission(dependencies, input),
  querySubmissions: (input) => querySubmissions(dependencies, input),
  finalizeSubmissionSent: (input) => finalizeSubmissionSent(dependencies, input),
  cancelSubmission: (input) => cancelSubmission(dependencies, input),
  getThread: (input) => getThread(dependencies, input),
  queryThreads: (input) => queryThreads(dependencies, input),
  updateThreadEmails: (input) => updateThreadEmails(dependencies, input),
  moveThreadEmails: (input) => moveThreadEmails(dependencies, input),
  getChanges: (input) => getChanges(dependencies, input),
  getState: (input) => getState(dependencies, input),
  uploadBlob: (input) => uploadBlob(dependencies, input),
  getBlob: (input) => getBlob(dependencies, input),
  readBlob: (input) => readBlob(dependencies, input),
  readBlobRange: (input) => readBlobRange(dependencies, input),
});
