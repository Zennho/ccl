import { invoke } from '@tauri-apps/api/core';
import { createRenderer } from '../react/renderer';
import { Shell } from '../react/shell';
import { createPageController } from '../react/page-controller';
import { createOverlayController } from '../react/overlay-controller';
import { createInputController } from '../lib/input-controller';
import { createRenderCycle } from '../lib/render-cycle';
import { createThumbnailLoader } from '../lib/thumbnails';
import { syncMemoryControls } from '../lib/memory-controls';
import { instanceColors } from '../lib/instance-theme';
import { installAddons } from './install-addons';
import type { LauncherState, createTheme } from '../lib/launcher-state';
import type { GameVersion } from '../react/types';
import type { createJobManager } from '../job-manager';
import type { createMultiplayer } from '../lib/multiplayer';
import type { AccountFeature } from './features/account';
import type { InstanceFeature } from './features/instances';

interface Options {
  container: HTMLElement;
  state: LauncherState;
  theme: ReturnType<typeof createTheme>;
  appVersion: string;
  account: AccountFeature;
  instances: InstanceFeature;
  jobs: ReturnType<typeof createJobManager>;
  multiplayer: ReturnType<typeof createMultiplayer>;
  applyTheme: () => void;
  persist: () => void;
}

/** Connect React regions and preserve input/scroll state during background updates. */
export function createApplicationView({
  container,
  state,
  theme,
  appVersion,
  account,
  instances,
  jobs,
  multiplayer,
  applyTheme,
  persist,
}: Options) {
  const renderer = createRenderer(container);
  const hydrateThumbnails = createThumbnailLoader({
    container,
    fetchThumbnail: (kind, value) => invoke('fetch_thumbnail', { kind, value }),
  });
  const syncMemory = () => syncMemoryControls(container);

  function versionVisual(version?: GameVersion) {
    const instance = version?.id ? instances.theme.getTheme(state.gameDir, version.id) : null;
    return {
      color: instance?.color || instanceColors[0],
      cover: version?.id ? instances.theme.getCover(state.gameDir, version.id) : null,
    };
  }

  function shellProps() {
    return {
      page: state.page,
      name: account.playerName(),
      status: account.playerStatus(),
      skin: account.playerSkin(),
      online: state.online,
      version: appVersion,
      installedCount: state.versions.filter((version) => version.installed).length,
      jobCount: jobs.activeJobCount(),
      updateInfo: state.updateInfo,
      updateDismissed: state.updateDismissed,
      notice: state.notice,
      noticeKind: state.noticeKind,
      noticeCrash: !!(state.crash && state.noticeCrash),
    };
  }

  const pages = createPageController({
    container,
    state,
    renderer,
    theme,
    appVersion,
    versionVisual,
    getInstanceTheme: instances.theme.getTheme,
    hasJob: jobs.hasJob,
    usingOnline: account.usingOnline,
    playerName: account.playerName,
    filteredServers: multiplayer.filteredServers,
    hydrateThumbnails,
  });
  const renderOverlay = createOverlayController({
    container,
    state,
    renderer,
    getLaunchSettings: instances.settings.get,
    getCover: instances.theme.getCover,
    colors: instanceColors,
    addons: installAddons,
    syncMemory,
  });

  function renderChrome() {
    if (container.querySelector('.app-shell')) renderer.chrome(Shell, shellProps());
    if (state.page === 'settings' && container.querySelector('#update-panel')) pages.settings();
  }

  // Input callbacks run after the render cycle is constructed. Keeping the callback
  // deferred lets the cycle consult IME composition before updating the page.
  const input = createInputController({
    container,
    state,
    theme,
    render: () => cycle.render(),
    renderSettings: pages.settings,
    renderMods: pages.content,
    renderPacks: pages.content,
    updateSearch: pages.search,
    applyTheme,
    persist,
  });
  const cycle = createRenderCycle({
    container,
    state,
    beforeRender: input.beforeRender,
    mount: () => renderer.mount(Shell, shellProps()),
    renderPage: pages.page,
    syncMemory,
    applyTheme,
    renderChrome,
    renderOverlay,
    hydrateThumbnails,
    refreshPreview: account.appearance.refreshPreview,
  });

  return { render: cycle.render, chrome: renderChrome, overlay: renderOverlay, pages, syncMemory };
}
