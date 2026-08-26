export type DeliveryDraft = {
  id: string;
  identityId: string;
};

type ExistingDraft = {
  id: string;
  lifecycle?: 'draft' | 'received' | 'sent';
  identityId?: string | null;
};

export async function resolveDeliveryDraft(input: {
  draftId?: string | null;
  loadDraft(draftId: string): Promise<ExistingDraft | null>;
  saveDraft(): Promise<DeliveryDraft>;
}): Promise<DeliveryDraft> {
  if (input.draftId === null || input.draftId === undefined) {
    return input.saveDraft();
  }
  const existing = await input.loadDraft(input.draftId);
  if (existing === null || existing.lifecycle !== 'draft') {
    throw new Error('DRAFT_NOT_FOUND');
  }
  if (!existing.identityId) {
    throw new Error('MAIL_IDENTITY_UNAVAILABLE');
  }
  return {
    id: existing.id,
    identityId: existing.identityId,
  };
}
