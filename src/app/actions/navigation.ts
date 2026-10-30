import type { LauncherState } from '../../lib/launcher-state';
import type { ClickHandler } from './types';

type AsyncAction = () => Promise<unknown>;
interface Options {
  state: LauncherState;
  render: () => void;
  refreshAccounts: AsyncAction;
  refreshAppearance: () => Promise<unknown>;
  refreshMemory: AsyncAction;
  refreshJava: AsyncAction;
  getJavaRequirement: (gameDir: string, version: string) => Promise<number | null>;
  refreshAddresses: AsyncAction;
  refreshServers: AsyncAction;
  refreshMods: AsyncAction;
  refreshPacks: AsyncAction;
  loadCategories: AsyncAction;
  searchContent: AsyncAction;
  invalidateMods: () => void;
}
export function createNavigationHandler(options: Options): ClickHandler {
  const { state, render } = options;
  let javaRequest = 0;
  async function open(page: string) {
    state.page = page;
    render();
    if (page === 'account') {
      void options.refreshAccounts();
      if (state.account && !state.appearance) void options.refreshAppearance();
    }
    if (page === 'settings') void options.refreshMemory();
    if (page === 'java') {
      const request = ++javaRequest,
        gameDir = state.gameDir,
        version = state.selected;
      state.javaRequirement = null;
      state.javaRequirementLoading = !!version;
      render();
      const requirement = version
        ? options.getJavaRequirement(gameDir, version).catch(() => null)
        : Promise.resolve(null);
      void requirement.then((value) => {
        if (request !== javaRequest || state.gameDir !== gameDir || state.selected !== version)
          return;
        state.javaRequirement =
          typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
        state.javaRequirementLoading = false;
        if (state.page === 'java') render();
      });
      await options.refreshJava();
    }
    if (page === 'multiplayer' && state.lanView === 'room') await options.refreshAddresses();
    if (page === 'multiplayer' && state.lanView === 'servers' && !state.serverCatalog)
      await options.refreshServers();
    if (page === 'content') {
      if (
        !state.contentTarget ||
        !state.versions.some((v) => v.installed && v.id === state.contentTarget)
      ) {
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
  return (target) => {
    const button = target.closest<HTMLElement>('[data-page]');
    if (!button) return false;
    return open(button.dataset.page || '');
  };
}
