interface State {
  contentTarget: string;
  contentSource: string;
  contentKind: string;
  contentSort: string;
  contentQuery: string;
  contentKey: string;
  contentCategory: string;
  contentGameFilter: string;
  contentLoaderFilter: string;
  contentEnvironment: string;
  contentResults: unknown[];
  contentPage: number;
  contentHasMore: boolean;
  contentLoaded: boolean;
  contentError: string;
  contentCategories: unknown[];
  packDelete: unknown;
  localMods: unknown[];
  selectedMods: Set<string>;
  modUpdates: unknown;
  modConflicts: unknown;
}
interface Options {
  state: State;
  render: () => void;
  invalidateMods: () => void;
  refreshMods: () => Promise<unknown>;
  refreshPacks: () => Promise<unknown>;
  loadCategories: () => Promise<unknown>;
  search: (force?: boolean) => Promise<unknown>;
}
export function createContentControls({
  state,
  render,
  invalidateMods,
  refreshMods,
  refreshPacks,
  loadCategories,
  search,
}: Options) {
  async function selectTarget(version: string) {
    state.selectedMods.clear();
    invalidateMods();
    state.modUpdates = null;
    state.modConflicts = null;
    state.contentTarget = version;
    state.contentResults = [];
    state.localMods = [];
    state.contentPage = 0;
    state.contentLoaded = false;
    await refreshMods();
    await refreshPacks();
    await search();
  }
  async function changeFilters(form: HTMLFormElement) {
    const data = new FormData(form),
      source = String(data.get('source') || ''),
      kind = String(data.get('kind') || ''),
      changedSource = state.contentSource !== source,
      changedKind = state.contentKind !== kind;
    state.contentSource = source;
    state.contentKind = kind;
    state.contentSort = String(data.get('sort') || '');
    state.contentQuery = String(data.get('query') || '').trim();
    state.contentKey = String(data.get('apiKey') || state.contentKey);
    state.contentCategory = changedSource || changedKind ? '' : String(data.get('category') || '');
    state.contentGameFilter = String(data.get('gameFilter') || state.contentGameFilter).trim();
    state.contentLoaderFilter = String(data.get('loaderFilter') || '');
    state.contentEnvironment = source === 'modrinth' ? String(data.get('environment') || '') : '';
    state.contentResults = [];
    state.contentPage = 0;
    state.contentHasMore = false;
    state.contentLoaded = false;
    state.contentError = '';
    state.packDelete = null;
    if (changedSource || changedKind) state.contentCategories = [];
    render();
    if (changedSource || changedKind) void loadCategories();
    await Promise.all([refreshPacks(), search()]);
  }
  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    state.contentSource = String(data.get('source') || '');
    state.contentKind = String(data.get('kind') || '');
    state.contentSort = String(data.get('sort') || '');
    state.contentQuery = String(data.get('query') || '').trim();
    state.contentKey = String(data.get('apiKey') || state.contentKey);
    state.contentCategory = String(data.get('category') || state.contentCategory);
    state.contentGameFilter = String(data.get('gameFilter') || '').trim();
    state.contentLoaderFilter = String(data.get('loaderFilter') || '');
    state.contentEnvironment = String(data.get('environment') || '');
    state.contentPage = 0;
    state.contentHasMore = false;
    void loadCategories();
    await search(true);
  }
  return { selectTarget, changeFilters, submit };
}
