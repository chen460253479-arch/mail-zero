import type { DraftContent } from '../model/draft';

type DraftSetContext = {
  accountId: string;
  state?: string;
};

const base = ({ accountId, state }: DraftSetContext) => ({
  accountId,
  ...(state ? { ifInState: state } : {}),
  create: {},
  update: {},
  destroy: [] as string[],
});

export function buildDraftCreateInput({
  clientId,
  content,
  ...context
}: DraftSetContext & {
  clientId: string;
  content: DraftContent;
}) {
  return {
    ...base(context),
    create: { [clientId]: content },
  };
}

export function buildDraftUpdateInput({
  draftId,
  draftRevision,
  content,
  ...context
}: DraftSetContext & {
  draftId: string;
  draftRevision: number;
  content: DraftContent;
}) {
  return {
    ...base(context),
    update: {
      [draftId]: {
        ...content,
        ifDraftRevision: draftRevision,
      },
    },
  };
}

const htmlEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/giu, '\n')
    .replace(/<\s*\/\s*(?:div|li|p)\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/&([a-z]+);/giu, (entity, name: string) => htmlEntities[name.toLowerCase()] ?? entity)
    .replace(/&#(\d+);/gu, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
