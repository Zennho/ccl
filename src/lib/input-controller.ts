import { appearanceDefaults, clampAppearance } from './appearance';

type AppearanceKey = keyof typeof appearanceDefaults;
interface InputState {
  page: string;
  themeView: { description: string } | null;
  serverQuery: string; serverPage: number; versionQuery: string;
  modQuery: string; packQuery: string;
  lanPort: string; lanTarget: string; lanTest: string;
}
interface InputControllerOptions {
  container: HTMLElement;
  state: InputState;
  theme: Record<AppearanceKey, number>;
  render: () => void;
  renderSettings: () => void;
  renderMods: () => void;
  renderPacks: () => void;
  updateSearch: (kind: 'server' | 'version') => void;
  applyTheme: () => void;
  persist: () => void;
}
export function createInputController({container, state, theme, render, renderSettings, renderMods, renderPacks, updateSearch, applyTheme, persist}: InputControllerOptions) {
  let composing = false, pendingRender = false;
  function searchInput(target: HTMLInputElement | HTMLTextAreaElement) {
    switch (target.id) {
      case 'server-search': state.serverQuery = target.value; state.serverPage = 0; break;
      case 'version-filter': state.versionQuery = target.value; break;
      case 'local-mod-search': state.modQuery = target.value; break;
      case 'local-pack-search': state.packQuery = target.value; break;
    }
  }
  function updateSearchView(id: string) {
    if (id === 'server-search' || id === 'version-filter') updateSearch(id === 'server-search' ? 'server' : 'version');
    else if (id === 'local-mod-search') renderMods();
    else if (id === 'local-pack-search') renderPacks();
  }
  container.addEventListener('compositionstart', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) composing = true;
  });
  container.addEventListener('compositionend', event => {
    if (!composing) return;
    composing = false;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    searchInput(target);
    if (pendingRender) { pendingRender = false; render(); }
    else updateSearchView(target.id);
  });
  container.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target.id === 'instance-description' && state.themeView) { state.themeView.description = target.value; return; }
    if (['local-pack-search', 'local-mod-search', 'server-search', 'version-filter'].includes(target.id)) {
      if (composing || (event instanceof InputEvent && event.isComposing)) return;
      searchInput(target); updateSearchView(target.id); return;
    }
    const key = target.dataset.themeSetting;
    if (key && Object.prototype.hasOwnProperty.call(appearanceDefaults, key)) {
      const setting = key as AppearanceKey;
      theme[setting] = clampAppearance(target.value, appearanceDefaults[setting], key.endsWith('Blur') ? 30 : 100);
      if (state.page === 'settings') renderSettings();
      applyTheme(); persist(); return;
    }
    if (target.id === 'lan-game-port') state.lanPort = target.value;
    if (target.id === 'lan-target') { state.lanTarget = target.value; state.lanTest = ''; }
    if (target.id === 'proxyUrl') target.setCustomValidity('');
    const pairs: Record<string,string> = { 'instance-memory-range':'instance-memory', 'instance-memory':'instance-memory-range', 'memory-range':'memory', 'memory':'memory-range' };
    const otherId = pairs[target.id];
    if (otherId && (target.id.endsWith('-range') || target.value)) {
      const other = container.querySelector<HTMLInputElement>(`#${otherId}`);
      if (other) other.value = target.value;
    }
  });
  return {
    beforeRender(samePage: boolean) {
      if (composing && samePage) { pendingRender = true; return false; }
      if (composing && !samePage) { composing = false; pendingRender = false; }
      return true;
    },
  };
}
