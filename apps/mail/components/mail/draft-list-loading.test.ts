import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const mailListSource = readFileSync(new URL('./mail-list.tsx', import.meta.url), 'utf8');
const draftHookSource = readFileSync(new URL('../../hooks/use-drafts.ts', import.meta.url), 'utf8');

describe('draft list loading', () => {
  it('renders draft rows from thread summaries without opening every draft', () => {
    expect(mailListSource).not.toContain("from '@/hooks/use-drafts'");
    expect(mailListSource).not.toContain('const draftQuery = useDraft(draftId)');
    expect(mailListSource).toContain('const recipient = message.to[0]');
    expect(mailListSource).toContain('{message.subject}');
  });

  it('keeps attachment bytes out of the base draft query', () => {
    const baseDraftHook = draftHookSource.slice(
      0,
      draftHookSource.indexOf('export const useDraftAttachments'),
    );
    expect(baseDraftHook).not.toContain('buildBlobDownloadUrl');
    expect(baseDraftHook).not.toContain('new File(');
  });
});
