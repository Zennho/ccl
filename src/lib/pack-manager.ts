export interface LocalPack {
  name: string;
  directory?: boolean;
  source?: string;
  projectId?: string;
}
export interface ShaderEnvironment {
  loader?: string;
  detected?: string[];
  uncertain?: boolean;
}
interface PackDelete {
  name: string;
  kind: string;
  version: string;
  gameDir: string;
}
interface State {
  page: string;
  contentKey: string;
  contentLoaded: boolean;
  packChecking: boolean;
  packWorking: boolean;
  packDelete: PackDelete | null;
  contentKind: string;
  contentTarget: string;
  gameDir: string;
  localPacks: LocalPack[];
  packUpdates: unknown;
  packError: string;
  shaderEnv: ShaderEnvironment | null;
  shaderEnvError: string;
  packLoading: boolean;
  shaderEnvLoading: boolean;
}
interface Options {
  state: State;
  render: () => void;
  renderPage: () => void;
  flash: (message: string, kind?: string) => void;
  invalidateContent: () => void;
  search: () => Promise<unknown>;
  list: (gameDir: string, version: string, kind: string) => Promise<unknown>;
  environment: (gameDir: string, version: string) => Promise<ShaderEnvironment>;
  remove: (draft: PackDelete) => Promise<unknown>;
  updates: (gameDir: string, version: string, kind: string, apiKey: string) => Promise<unknown>;
}
export function createPackManager({
  state,
  render,
  renderPage,
  flash,
  invalidateContent,
  search,
  list,
  environment,
  remove,
  updates,
}: Options) {
  let epoch = 0;
  async function refresh() {
    const kind = state.contentKind,
      version = state.contentTarget,
      gameDir = state.gameDir,
      request = ++epoch;
    state.localPacks = [];
    state.packUpdates = null;
    state.packError = '';
    state.shaderEnv = null;
    state.shaderEnvError = '';
    if (!['resourcepack', 'shader'].includes(kind) || !version) {
      state.packLoading = false;
      state.shaderEnvLoading = false;
      render();
      return;
    }
    state.packLoading = true;
    state.shaderEnvLoading = kind === 'shader';
    render();
    const current = () =>
      request === epoch &&
      kind === state.contentKind &&
      version === state.contentTarget &&
      gameDir === state.gameDir;
    const packs = list(gameDir, version, kind)
      .then((result) => {
        if (current()) state.localPacks = Array.isArray(result) ? result : [];
      })
      .catch((error) => {
        if (current()) state.packError = String(error);
      })
      .finally(() => {
        if (current()) {
          state.packLoading = false;
          render();
        }
      });
    const env =
      kind === 'shader'
        ? environment(gameDir, version)
            .then((result) => {
              if (current()) state.shaderEnv = result;
            })
            .catch((error) => {
              if (current()) state.shaderEnvError = String(error);
            })
            .finally(() => {
              if (current()) {
                state.shaderEnvLoading = false;
                render();
              }
            })
        : Promise.resolve();
    await Promise.all([packs, env]);
  }
  async function confirmRemove() {
    const draft = state.packDelete;
    if (!draft || state.packWorking) return;
    state.packDelete = null;
    state.packWorking = true;
    renderPage();
    try {
      await remove(draft);
      flash('资源包已删除。');
      if (
        draft.version === state.contentTarget &&
        draft.gameDir === state.gameDir &&
        draft.kind === state.contentKind
      ) {
        await refresh();
        invalidateContent();
        state.contentLoaded = false;
        await search();
      }
    } catch (error) {
      flash(`删除失败：${error}`, 'error');
    } finally {
      state.packWorking = false;
      if (state.page === 'content') renderPage();
    }
  }
  async function checkUpdates() {
    if (state.packChecking || state.packWorking || !state.contentTarget) return;
    const version = state.contentTarget,
      gameDir = state.gameDir,
      kind = state.contentKind,
      request = epoch;
    state.packChecking = true;
    state.packUpdates = null;
    render();
    try {
      const result = await updates(gameDir, version, kind, state.contentKey);
      if (
        request === epoch &&
        version === state.contentTarget &&
        gameDir === state.gameDir &&
        kind === state.contentKind
      )
        state.packUpdates = result;
    } catch (error) {
      flash(`检查更新失败：${error}`, 'error');
    } finally {
      state.packChecking = false;
      render();
    }
  }
  return {
    refresh,
    confirmRemove,
    checkUpdates,
    revision: () => epoch,
    invalidate: () => {
      epoch++;
    },
  };
}
