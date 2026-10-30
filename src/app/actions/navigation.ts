import type {LauncherState} from '../../lib/launcher-state';
import type {ClickHandler} from './types';

type AsyncAction = () => Promise<unknown>;
interface Options {
  state: LauncherState;
  render: () => void;
  refreshAccounts: AsyncAction;
  refreshAppearance: () => Promise<unknown>;
  refreshMemory: AsyncAction;
  refreshJava: AsyncAction;
  refreshAddresses: AsyncAction;
  refreshServers: AsyncAction;
  refreshMods: AsyncAction;
  refreshPacks: AsyncAction;
  loadCategories: AsyncAction;
  searchContent: AsyncAction;
  invalidateMods: () => void;
}
export function createNavigationHandler(options: Options): ClickHandler {
  const {state,render} = options;
  async function open(page: string) {
    state.page = page;
    render();
    if (page === 'account') {
      void options.refreshAccounts();
      if (state.account && !state.appearance) void options.refreshAppearance();
    }
    if (page === 'settings') void options.refreshMemory();
    if (page === 'java') await options.refreshJava();
    if (page === 'multiplayer' && state.lanView === 'room') await options.refreshAddresses();
    if (page === 'multiplayer' && state.lanView === 'servers' && !state.serverCatalog) await options.refreshServers();
    if (page === 'content') {
      if (!state.contentTarget || !state.versions.some(v => v.installed && v.id === state.contentTarget)) {
        state.contentTarget = state.selected || '';
        state.selectedMods.clear();
        state.modUpdates = null;
        options.invalidateMods();
        state.contentPage = 0;
        state.contentLoaded = false;
      }
      await options.refreshMods();
      await options.refreshPacks();
      void options.loadCategories();
      if (!state.contentLoaded) await options.searchContent();
    }
  }
  return target => {
    const button = target.closest<HTMLElement>('[data-page]');
    if (!button) return false;
    return open(button.dataset.page || '');
  };
}
