import { describe, expect, it, vi } from 'vitest';

import { resolveDeliveryDraft } from './delivery-draft';

describe('resolveDeliveryDraft', () => {
  it('uses an existing immutable Draft without saving it again', async () => {
    const loadDraft = vi.fn(async () => ({
      id: 'draft-1',
      lifecycle: 'draft' as const,
      identityId: 'identity-1',
    }));
    const saveDraft = vi.fn();

    await expect(
      resolveDeliveryDraft({ draftId: 'draft-1', loadDraft, saveDraft }),
    ).resolves.toEqual({ id: 'draft-1', identityId: 'identity-1' });

    expect(loadDraft).toHaveBeenCalledWith('draft-1');
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves only when there is no existing Draft', async () => {
    const loadDraft = vi.fn();
    const saveDraft = vi.fn(async () => ({ id: 'draft-new', identityId: 'identity-1' }));

    await expect(resolveDeliveryDraft({ loadDraft, saveDraft })).resolves.toEqual({
      id: 'draft-new',
      identityId: 'identity-1',
    });

    expect(loadDraft).not.toHaveBeenCalled();
    expect(saveDraft).toHaveBeenCalledOnce();
  });

  it('rejects an invalid existing Draft instead of silently rebuilding it', async () => {
    await expect(
      resolveDeliveryDraft({
        draftId: 'draft-1',
        loadDraft: async () => ({ id: 'draft-1', lifecycle: 'sent', identityId: null }),
        saveDraft: vi.fn(),
      }),
    ).rejects.toThrow('DRAFT_NOT_FOUND');
  });
});
