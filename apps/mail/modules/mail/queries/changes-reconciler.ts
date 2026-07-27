export type ChangesPage = {
  oldState: string;
  newState: string;
  hasMoreChanges: boolean;
  created: string[];
  updated: string[];
  destroyed: string[];
};

export async function drainChanges(
  sinceState: string,
  fetchPage: (state: string) => Promise<ChangesPage>,
) {
  let state = sinceState;
  const created = new Set<string>();
  const updated = new Set<string>();
  const destroyed = new Set<string>();

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await fetchPage(state);
    for (const id of page.created) created.add(id);
    for (const id of page.updated) updated.add(id);
    for (const id of page.destroyed) destroyed.add(id);

    if (page.hasMoreChanges && page.newState === state) {
      throw new Error('MAIL_CHANGES_DID_NOT_ADVANCE');
    }
    state = page.newState;
    if (!page.hasMoreChanges) {
      return {
        newState: state,
        created: [...created],
        updated: [...updated],
        destroyed: [...destroyed],
      };
    }
  }

  throw new Error('MAIL_CHANGES_PAGE_LIMIT_EXCEEDED');
}
