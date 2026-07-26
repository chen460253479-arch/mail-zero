export type PubSubIamPolicy = {
  bindings?: { role: string; members: string[] }[];
};

const PUBLISHER_ROLE = 'roles/pubsub.publisher';

export const ensurePubSubPublisher = (
  policy: PubSubIamPolicy,
  publisher: string,
): PubSubIamPolicy => {
  const bindings = (policy.bindings ?? []).map((binding) => ({
    ...binding,
    members: [...binding.members],
  }));
  const publisherBinding = bindings.find(({ role }) => role === PUBLISHER_ROLE);
  if (publisherBinding === undefined) {
    bindings.push({ role: PUBLISHER_ROLE, members: [publisher] });
  } else if (!publisherBinding.members.includes(publisher)) {
    publisherBinding.members.push(publisher);
  }
  return { ...policy, bindings };
};
