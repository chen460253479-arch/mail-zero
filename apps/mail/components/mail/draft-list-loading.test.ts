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

  it('always fetches draft details when the editor is opened', () => {
    const baseDraftHook = draftHookSource.slice(
      0,
      draftHookSource.indexOf('export const useDraftAttachments'),
    );
    expect(baseDraftHook).toContain('staleTime: 0');
    expect(baseDraftHook).toContain('gcTime: 0');
    expect(baseDraftHook).toContain("refetchOnMount: 'always'");
    expect(baseDraftHook).not.toContain('staleTime: 60 * 60_000');
  });

  it('always downloads attachments when the draft editor is opened', () => {
    const attachmentHook = draftHookSource.slice(
      draftHookSource.indexOf('export const useDraftAttachments'),
    );
    expect(attachmentHook).toContain('staleTime: 0');
    expect(attachmentHook).toContain('gcTime: 0');
    expect(attachmentHook).toContain("refetchOnMount: 'always'");
    expect(attachmentHook).not.toContain('staleTime: 60 * 60_000');
  });
});
