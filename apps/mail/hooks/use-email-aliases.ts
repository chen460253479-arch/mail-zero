import { useMailIdentities } from '@/modules/mail';

export function useEmailAliases() {
  const query = useMailIdentities();
  return {
    ...query,
    data: query.identities.map((identity) => ({
      id: identity.id,
      email: identity.email,
      name: identity.name ?? identity.email,
      primary: identity.isDefault,
    })),
  };
}
