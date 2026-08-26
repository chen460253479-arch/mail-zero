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
    expect(draftHookSource).not.toContain('buildBlobDownloadUrl');
    expect(draftHookSource).not.toContain('new File(');
    expect(draftHookSource).not.toContain('fetch(');
  });

  it('always fetches draft details when the editor is opened', () => {
    expect(draftHookSource).toContain('staleTime: 0');
    expect(draftHookSource).toContain('gcTime: 0');
    expect(draftHookSource).toContain("refetchOnMount: 'always'");
    expect(draftHookSource).not.toContain('staleTime: 60 * 60_000');
  });

  it('returns persisted attachment metadata without a download cache', () => {
    expect(draftHookSource).toContain("'attachments'");
    expect(draftHookSource).toContain('blobId: part.blobId');
    expect(draftHookSource).toContain("filename: part.filename ?? 'attachment'");
    expect(draftHookSource).not.toContain('DRAFT_ATTACHMENT_CACHE_RETENTION');
    expect(draftHookSource).not.toContain('staleTime: Infinity');
    expect(draftHookSource).not.toContain('meta: { persist: false }');
  });
});
