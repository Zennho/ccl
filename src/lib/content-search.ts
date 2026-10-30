interface ContentHit {
  id: string;
  description?: string;
  localizedDescription?: string;
}
interface Category {
  id: string;
  name: string;
}
interface SearchResult {
  hits: ContentHit[];
  hasMore: boolean;
}
interface SearchSnapshot {
  source: string;
  kind: string;
  query: string;
  apiKey: string;
  gameDir: string;
  version: string;
  page: number;
  sort: string;
  category: string;
  gameFilter: string;
  loaderFilter: string;
  environment: string;
}
interface ContentState {
  page: string;
  contentSource: string;
  contentKind: string;
  contentKey: string;
  contentTarget: string;
  contentQuery: string;
  gameDir: string;
  contentPage: number;
  contentSort: string;
  contentCategory: string;
  contentGameFilter: string;
  contentLoaderFilter: string;
  contentEnvironment: string;
  contentCategories: Category[];
  contentCategoryError: string;
  contentCategoriesLoading: boolean;
  contentBusy: boolean;
  contentError: string;
  contentResults: ContentHit[];
  contentHasMore: boolean;
  contentLoaded: boolean;
}
interface Options {
  state: ContentState;
  modRevision: () => number;
  render: () => void;
  renderContent: () => void;
  categories: (source: string, kind: string, apiKey: string) => Promise<unknown>;
  search: (snapshot: SearchSnapshot) => Promise<SearchResult>;
  translate: (
    source: string,
    items: { projectId: string; summary: string }[],
  ) => Promise<Record<string, string> | null>;
}
export function createContentSearch({
  state,
  modRevision,
  render,
  renderContent,
  categories,
  search,
  translate,
}: Options) {
  const categoryCache = new Map<string, { items: Category[]; expires: number }>(),
    contentCache = new Map<string, { result: SearchResult; expires: number }>();
  let categoryEpoch = 0,
    contentEpoch = 0;
  async function loadContentCategories() {
    const source = state.contentSource,
      kind = state.contentKind,
      apiKey = state.contentKey,
      epoch = ++categoryEpoch,
      key = JSON.stringify([source, kind]);
    state.contentCategories = [];
    state.contentCategoryError = '';
    if (source === 'curseforge' && !apiKey.trim()) {
      state.contentCategoriesLoading = false;
      renderContent();
      return;
    }
    const cached = source === 'modrinth' ? categoryCache.get(key) : null;
    if (cached && cached.expires > Date.now()) {
      state.contentCategories = cached.items;
      state.contentCategoriesLoading = false;
      renderContent();
      return;
    }
    state.contentCategoriesLoading = true;
    renderContent();
    try {
      const result = await categories(source, kind, apiKey);
      if (epoch !== categoryEpoch) return;
      const items: Array<Category> = Array.isArray(result)
        ? result.filter(
            (c): c is Category => typeof c?.id === 'string' && typeof c?.name === 'string',
          )
        : [];
      state.contentCategories = items;
      if (source === 'modrinth') categoryCache.set(key, { items, expires: Date.now() + 3600000 });
    } catch (error) {
      if (epoch === categoryEpoch) state.contentCategoryError = String(error);
    } finally {
      if (epoch === categoryEpoch) {
        state.contentCategoriesLoading = false;
        renderContent();
      }
    }
  }
  async function translateSummaries(source: string, hits: ContentHit[]) {
    if (!hits.length) return;
    try {
      const translations = await translate(
        source,
        hits.map((hit) => ({ projectId: hit.id, summary: hit.description || '' })),
      );
      if (state.contentResults !== hits || state.contentSource !== source || !translations) return;
      hits.forEach((hit) => {
        if (typeof translations[hit.id] === 'string' && translations[hit.id].trim())
          hit.localizedDescription = translations[hit.id];
      });
      renderContent();
    } catch {
      /* Preserve the original summaries when translation is unavailable. */
    }
  }
  async function searchContent(force = false): Promise<void> {
    if (state.contentBusy) return;
    if (
      (state.contentKind !== 'modpack' && !state.contentTarget) ||
      (state.contentSource === 'curseforge' && !state.contentKey.trim())
    ) {
      state.contentLoaded = false;
      state.contentResults = [];
      state.contentError = '';
      if (state.page === 'content') render();
      return;
    }
    const snapshot: SearchSnapshot = {
      source: state.contentSource,
      kind: state.contentKind,
      query: state.contentQuery,
      apiKey: state.contentKey,
      gameDir: state.gameDir,
      version: state.contentTarget,
      page: state.contentPage,
      sort: state.contentSort,
      category: state.contentCategory,
      gameFilter: state.contentKind === 'modpack' ? state.contentGameFilter : '',
      loaderFilter: state.contentKind === 'modpack' ? state.contentLoaderFilter : '',
      environment: state.contentSource === 'modrinth' ? state.contentEnvironment : '',
    };
    const key = JSON.stringify([snapshot, contentEpoch, modRevision()]),
      epoch = contentEpoch;
    state.contentBusy = true;
    state.contentError = '';
    render();
    const current = () =>
      epoch === contentEpoch &&
      snapshot.version === state.contentTarget &&
      snapshot.kind === state.contentKind &&
      snapshot.source === state.contentSource &&
      snapshot.page === state.contentPage &&
      snapshot.sort === state.contentSort &&
      snapshot.query === state.contentQuery &&
      snapshot.gameDir === state.gameDir &&
      snapshot.category === state.contentCategory &&
      snapshot.gameFilter === (state.contentKind === 'modpack' ? state.contentGameFilter : '') &&
      snapshot.loaderFilter ===
        (state.contentKind === 'modpack' ? state.contentLoaderFilter : '') &&
      snapshot.environment === (state.contentSource === 'modrinth' ? state.contentEnvironment : '');
    try {
      const entry = !force && snapshot.source === 'modrinth' ? contentCache.get(key) : null,
        cached = entry && entry.expires > Date.now() ? entry : null;
      const result = cached ? cached.result : await search(snapshot);
      if (!cached && snapshot.source === 'modrinth') {
        contentCache.set(key, { result, expires: Date.now() + 45000 });
        if (contentCache.size > 40) {
          const oldest = contentCache.keys().next().value;
          if (oldest !== undefined) contentCache.delete(oldest);
        }
      }
      if (current()) {
        state.contentResults = result.hits;
        state.contentHasMore = result.hasMore;
        state.contentLoaded = true;
        void translateSummaries(snapshot.source, result.hits);
      }
    } catch (error) {
      if (current()) {
        state.contentError = String(error);
        state.contentLoaded = false;
        state.contentHasMore = false;
        state.contentResults = [];
      }
    }
    state.contentBusy = false;
    if (state.page === 'content') {
      if (!current()) await searchContent();
      else render();
    }
  }
  return {
    loadContentCategories,
    searchContent,
    invalidate() {
      contentEpoch++;
    },
  };
}
