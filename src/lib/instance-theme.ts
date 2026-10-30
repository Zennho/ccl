import type { GameVersion } from '../react/types';
export const instanceColors = ['#76956d', '#6d91a3', '#a68072', '#9b83a9', '#c29d63', '#7f8a78'];
export const instanceKey = (gameDir: string, version: string) => JSON.stringify([gameDir, version]);
interface ThemeEntry {
  color: string;
  description: string;
  hasCover: boolean;
}
export interface ThemeDraft extends ThemeEntry {
  version: string;
  gameDir: string;
  name: string;
  file: File | null;
  preview: string | null;
  removeCover: boolean;
  error: string;
  saving: boolean;
}
interface State {
  page: string;
  gameDir: string;
  selected: string;
  versions: GameVersion[];
  themeView: ThemeDraft | null;
}
interface Options {
  state: State;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  store: (mode: 'get' | 'put' | 'delete', key: string, value?: unknown) => Promise<unknown>;
  validate: (file: File) => Promise<void>;
  render: () => void;
  renderOverlay: () => void;
  applyTheme: () => void;
  flash: (message: string, kind?: string) => void;
}
export function createInstanceTheme({
  state,
  storage,
  store,
  validate,
  render,
  renderOverlay,
  applyTheme,
  flash,
}: Options) {
  let themes: Record<string, ThemeEntry> = {};
  try {
    const value = JSON.parse(storage.getItem('ccl-instance-themes') || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) themes = value;
  } catch {}
  const covers = new Map<string, string>(),
    pending = new Map<string, Promise<void>>(),
    revisions = new Map<string, number>();
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRender() {
    if (renderTimer !== null) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (state.page === 'home' || state.page === 'versions') render();
    }, 50);
  }
  function getTheme(gameDir: string, version: string): ThemeEntry {
    const entry = themes[instanceKey(gameDir, version)];
    return {
      color: instanceColors.includes(entry?.color) ? entry.color : instanceColors[0],
      description: typeof entry?.description === 'string' ? entry.description.slice(0, 180) : '',
      hasCover: entry?.hasCover === true,
    };
  }
  function getCover(gameDir: string, version: string) {
    return covers.get(instanceKey(gameDir, version)) || null;
  }
  async function load(gameDir: string, version: string): Promise<void> {
    if (!gameDir || !version) return;
    const key = instanceKey(gameDir, version);
    if (!getTheme(gameDir, version).hasCover || covers.has(key)) return;
    const existing = pending.get(key);
    if (existing) return existing;
    const revision = revisions.get(key) || 0;
    const task = store('get', `instance-cover:${key}`)
      .then((blob) => {
        if (!blob || revision !== (revisions.get(key) || 0) || !getTheme(gameDir, version).hasCover)
          return;
        const old = covers.get(key);
        if (old) URL.revokeObjectURL(old);
        covers.set(key, URL.createObjectURL(blob as Blob));
        if (state.gameDir === gameDir && state.selected === version) applyTheme();
        scheduleRender();
      })
      .catch(() => {})
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key);
      });
    pending.set(key, task);
    return task;
  }
  function loadInstalled() {
    for (const version of state.versions.filter((v) => v.installed))
      void load(state.gameDir, version.id);
  }
  async function open(version: string) {
    const item = state.versions.find((v) => v.id === version && v.installed);
    if (!item) return;
    state.themeView = {
      version,
      gameDir: state.gameDir,
      name: item.name || version,
      ...getTheme(state.gameDir, version),
      file: null,
      preview: null,
      removeCover: false,
      error: '',
      saving: false,
    };
    renderOverlay();
    await load(state.gameDir, version);
    if (state.themeView?.version === version) renderOverlay();
  }
  function setColor(color: string) {
    const draft = state.themeView;
    if (draft && !draft.saving && instanceColors.includes(color)) {
      draft.color = color;
      renderOverlay();
    }
  }
  function close() {
    const draft = state.themeView;
    if (!draft || draft.saving) return;
    if (draft.preview) URL.revokeObjectURL(draft.preview);
    state.themeView = null;
    renderOverlay();
  }
  function removeCover() {
    const draft = state.themeView;
    if (!draft || draft.saving) return;
    if (draft.preview) URL.revokeObjectURL(draft.preview);
    draft.preview = null;
    draft.file = null;
    draft.removeCover = true;
    renderOverlay();
  }
  async function chooseCover(file: File) {
    const draft = state.themeView;
    if (!draft) return;
    try {
      await validate(file);
      if (state.themeView !== draft) return;
      if (draft.preview) URL.revokeObjectURL(draft.preview);
      draft.preview = URL.createObjectURL(file);
      draft.file = file;
      draft.removeCover = false;
      draft.error = '';
      renderOverlay();
    } catch (error) {
      if (state.themeView === draft) {
        draft.error = String(error);
        renderOverlay();
      }
    }
  }
  async function save(description: string) {
    const draft = state.themeView;
    if (!draft || draft.saving) return;
    const key = instanceKey(draft.gameDir, draft.version);
    revisions.set(key, (revisions.get(key) || 0) + 1);
    draft.description = description.slice(0, 180);
    draft.saving = true;
    draft.error = '';
    renderOverlay();
    try {
      if (draft.file) await store('put', `instance-cover:${key}`, draft.file);
      else if (draft.removeCover) await store('delete', `instance-cover:${key}`);
      const old = covers.get(key);
      if ((draft.file || draft.removeCover) && old) {
        URL.revokeObjectURL(old);
        covers.delete(key);
      }
      if (draft.file) covers.set(key, URL.createObjectURL(draft.file));
      themes[key] = {
        color: draft.color,
        description: draft.description,
        hasCover: draft.file ? true : draft.removeCover ? false : draft.hasCover,
      };
      storage.setItem('ccl-instance-themes', JSON.stringify(themes));
      if (draft.preview) URL.revokeObjectURL(draft.preview);
      state.themeView = null;
      render();
      flash('实例主题已保存。');
    } catch (error) {
      draft.error = String(error);
      draft.saving = false;
      renderOverlay();
    }
  }
  return {
    getTheme,
    getCover,
    load,
    loadInstalled,
    open,
    setColor,
    close,
    removeCover,
    chooseCover,
    save,
  };
}
