import type { IdentityId, IdentityRecord, MailAccountId, MailCore } from '@zero/mail-core';
import type { z } from 'zod';

import {
  identityChangesInputSchema,
  identitySchema,
  identitySetInputSchema,
} from '../contracts/identity';
import { mapSetErrors } from './dto';

export const toIdentityDto = (identity: IdentityRecord) => identitySchema.parse(identity);

export const createIdentityService = (
  core: Pick<MailCore, 'getChanges' | 'getState' | 'listIdentities' | 'setIdentities'>,
) => ({
  async get(input: { accountId: string; ids?: string[] }) {
    const accountId = input.accountId as MailAccountId;
    const state = await core.getState({ accountId, collection: 'identity' });
    const identities = await core.listIdentities({ accountId });
    const byId = new Map(identities.map((identity) => [identity.id, identity]));
    const ids = input.ids ?? identities.map(({ id }) => id);
    return {
      accountId: input.accountId,
      state,
      list: ids.flatMap((id) => {
        const identity = byId.get(id as IdentityId);
        return identity === undefined ? [] : [toIdentityDto(identity)];
      }),
      notFound: ids.filter((id) => !byId.has(id as IdentityId)),
    };
  },
  async set(input: z.infer<typeof identitySetInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const result = await core.setIdentities({
      ...input,
      accountId,
      update: Object.fromEntries(
        Object.entries(input.update).map(([id, patch]) => [id as IdentityId, patch]),
      ),
      destroy: input.destroy as IdentityId[],
    });
    return {
      accountId,
      ...result,
      created: Object.fromEntries(
        Object.entries(result.created).map(([id, identity]) => [id, toIdentityDto(identity)]),
      ),
      updated: Object.fromEntries(
        Object.entries(result.updated).map(([id, identity]) => [id, toIdentityDto(identity)]),
      ),
      notCreated: mapSetErrors(result.notCreated),
      notUpdated: mapSetErrors(result.notUpdated),
      notDestroyed: mapSetErrors(result.notDestroyed),
    };
  },
  changes(input: z.infer<typeof identityChangesInputSchema>) {
    return core.getChanges({
      ...input,
      accountId: input.accountId as MailAccountId,
      collection: 'identity',
    });
  },
});
