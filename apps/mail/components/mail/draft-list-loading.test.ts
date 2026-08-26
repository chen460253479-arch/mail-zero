import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const mailListSource = readFileSync(new URL('./mail-list.tsx', import.meta.url), 'utf8');
const draftHookSource = readFileSync(new URL('../../hooks/use-drafts.ts', import.meta.url), 'utf8');
const queryProviderSource = readFileSync(
  new URL('../../providers/query-provider.tsx', import.meta.url),
  'utf8',
);

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

  it('keeps downloaded attachments in memory when the draft editor is briefly closed', () => {
    const attachmentHook = draftHookSource.slice(
      draftHookSource.indexOf('export const useDraftAttachments'),
    );
    expect(draftHookSource).toContain('const DRAFT_ATTACHMENT_CACHE_RETENTION = 10 * 60_000');
    expect(attachmentHook).toContain('staleTime: Infinity');
    expect(attachmentHook).toContain('gcTime: DRAFT_ATTACHMENT_CACHE_RETENTION');
    expect(attachmentHook).toContain('meta: { persist: false }');
    expect(attachmentHook).not.toContain("refetchOnMount: 'always'");
    expect(queryProviderSource).toContain('query.meta?.persist !== false');
  });
});
