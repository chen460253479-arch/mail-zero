export { createMailAccount } from './create-account';
export {
  getMailAccount,
  listMailAccounts,
  type GetMailAccountInput,
  type ListMailAccountsInput,
} from './get-account';
export { listIdentities, type ListIdentitiesInput } from './list-identities';
export { createIdentity, destroyIdentity, updateIdentity } from './manage-identity';
export {
  setIdentities,
  type CreateIdentityData,
  type SetIdentitiesInput,
  type SetIdentitiesResult,
  type UpdateIdentityPatch,
} from './set-identities';
export type {
  CreateIdentityInput,
  CreateMailAccountInput,
  DestroyIdentityInput,
  UpdateIdentityInput,
} from './types';
