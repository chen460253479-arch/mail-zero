import {
  createDraft,
  destroyDraft,
  destroyEmail,
  getEmail,
  importEmail,
  queryEmails,
  updateDraft,
  updateEmail,
} from './message';
import { createIdentity, createMailAccount, destroyIdentity, updateIdentity } from './account';
import { createMailbox, destroyMailbox, listMailboxes, updateMailbox } from './mailbox';
import { cancelSubmission, createSubmission } from './submission';
import type { MailCoreDependencies } from './store';
import { getThread, queryThreads } from './thread';
import { getChanges } from './changes';
import { readBlob } from './blob';

type BoundCommand<Command extends (...arguments_: never[]) => unknown> = (
  input: Parameters<Command>[1],
) => ReturnType<Command>;

export type MailCore = {
  createAccount: BoundCommand<typeof createMailAccount>;
  createIdentity: BoundCommand<typeof createIdentity>;
  updateIdentity: BoundCommand<typeof updateIdentity>;
  destroyIdentity: BoundCommand<typeof destroyIdentity>;
  createMailbox: BoundCommand<typeof createMailbox>;
  updateMailbox: BoundCommand<typeof updateMailbox>;
  destroyMailbox: BoundCommand<typeof destroyMailbox>;
  listMailboxes: BoundCommand<typeof listMailboxes>;
  importEmail: BoundCommand<typeof importEmail>;
  getEmail: BoundCommand<typeof getEmail>;
  queryEmails: BoundCommand<typeof queryEmails>;
  updateEmail: BoundCommand<typeof updateEmail>;
  destroyEmail: BoundCommand<typeof destroyEmail>;
  createDraft: BoundCommand<typeof createDraft>;
  updateDraft: BoundCommand<typeof updateDraft>;
  destroyDraft: BoundCommand<typeof destroyDraft>;
  createSubmission: BoundCommand<typeof createSubmission>;
  cancelSubmission: BoundCommand<typeof cancelSubmission>;
  getThread: BoundCommand<typeof getThread>;
  queryThreads: BoundCommand<typeof queryThreads>;
  getChanges: BoundCommand<typeof getChanges>;
  readBlob: BoundCommand<typeof readBlob>;
};

export const createMailCore = (dependencies: MailCoreDependencies): MailCore => ({
  createAccount: (input) => createMailAccount(dependencies, input),
  createIdentity: (input) => createIdentity(dependencies, input),
  updateIdentity: (input) => updateIdentity(dependencies, input),
  destroyIdentity: (input) => destroyIdentity(dependencies, input),
  createMailbox: (input) => createMailbox(dependencies, input),
  updateMailbox: (input) => updateMailbox(dependencies, input),
  destroyMailbox: (input) => destroyMailbox(dependencies, input),
  listMailboxes: (input) => listMailboxes(dependencies, input),
  importEmail: (input) => importEmail(dependencies, input),
  getEmail: (input) => getEmail(dependencies, input),
  queryEmails: (input) => queryEmails(dependencies, input),
  updateEmail: (input) => updateEmail(dependencies, input),
  destroyEmail: (input) => destroyEmail(dependencies, input),
  createDraft: (input) => createDraft(dependencies, input),
  updateDraft: (input) => updateDraft(dependencies, input),
  destroyDraft: (input) => destroyDraft(dependencies, input),
  createSubmission: (input) => createSubmission(dependencies, input),
  cancelSubmission: (input) => cancelSubmission(dependencies, input),
  getThread: (input) => getThread(dependencies, input),
  queryThreads: (input) => queryThreads(dependencies, input),
  getChanges: (input) => getChanges(dependencies, input),
  readBlob: (input) => readBlob(dependencies, input),
});
