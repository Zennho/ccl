import { createNavigationHandler } from './actions/navigation';
import { createShellHandler, installWindowResize, closeVersionMenus } from './actions/shell';
import { createInstanceHandler } from './actions/instances';
import { createAccountHandler } from './actions/account';
import { createContentHandler } from './actions/content';
import { createDownloadHandler } from './actions/downloads';
import { createMultiplayerHandler } from './actions/multiplayer';
import { createArchiveHandler } from './actions/archive';
import { createLauncherHandler } from './actions/launcher';
import { installFormEvents } from './form-events';
import { installClickDispatcher } from './click-dispatcher';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { copyText } from '../lib/multiplayer';
import { installAddons } from './install-addons';
import type { LauncherState } from '../lib/launcher-state';
import type { AccountFeature } from './features/account';
import type { ContentFeature } from './features/content';
import type { InstanceFeature } from './features/instances';
import type { createApplicationView } from './view';
import type { createAppearanceController } from '../lib/appearance-controller';
import type { createSystemStatus } from '../lib/system-status';
import type { createMultiplayer } from '../lib/multiplayer';
import type { createJobManager } from '../job-manager';
import type { createArchiveManager } from '../lib/archive-manager';
import type { createGlobalSettings } from '../lib/global-settings';
import type { createContentInstall } from '../lib/content-install';
import type { createGameLauncher } from '../lib/game-launcher';

interface Options {
  container: HTMLElement;
  state: LauncherState;
  view: ReturnType<typeof createApplicationView>;
  account: AccountFeature;
  content: ContentFeature;
  instances: InstanceFeature;
  appearance: ReturnType<typeof createAppearanceController>;
  system: ReturnType<typeof createSystemStatus>;
  multiplayer: ReturnType<typeof createMultiplayer>;
  jobs: ReturnType<typeof createJobManager>;
  archive: ReturnType<typeof createArchiveManager>;
  settings: ReturnType<typeof createGlobalSettings>;
  contentInstall: ReturnType<typeof createContentInstall>;
  launchGame: ReturnType<typeof createGameLauncher>;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
  showCrash: (crash: NonNullable<LauncherState['crash']>) => void;
}

/** Register all user interactions after controllers and rendering are ready. */
export function installApplicationEvents({
  container,
  state,
  view,
  account,
  content,
  instances,
  appearance,
  system,
  multiplayer,
  jobs,
  archive,
  settings,
  contentInstall,
  launchGame,
  persist,
  flash,
  showCrash,
}: Options) {
  const { render, chrome: renderChrome, overlay: renderOverlay } = view;
  const shellOptions = {
    container,
    isDesktop: isTauri,
    getWindow: getCurrentWindow,
    resetTheme: appearance.reset,
    flash,
  };
  installWindowResize(shellOptions);
  const handleShell = createShellHandler(shellOptions);
  const handleNavigation = createNavigationHandler({
    state,
    render,
    refreshAccounts: account.appearance.refreshAccountList,
    refreshAppearance: () => account.appearance.refreshAppearance({ reuse: true }),
    refreshMemory: system.refreshMemoryInfo,
    refreshJava: instances.versions.refreshJava,
    getJavaRequirement: (gameDir, version) =>
      invoke<number | null>('required_java_version', { gameDir, version }),
    refreshAddresses: multiplayer.refreshAddresses,
    refreshServers: multiplayer.refreshPublicServers,
    refreshMods: content.mods.refreshMods,
    refreshPacks: content.packs.refresh,
    loadCategories: content.search.loadContentCategories,
    searchContent: content.search.searchContent,
    invalidateMods: content.mods.invalidate,
  });
  const handleAccount = createAccountHandler({
    state,
    render,
    account: account.actions,
    skin: account.skin,
    searchContent: content.search.searchContent,
  });
  const handleContent = createContentHandler({
    container,
    state,
    invoke,
    render,
    renderOverlay,
    flash,
    search: content.search.searchContent,
    install: contentInstall,
    mods: content.mods,
    packs: content.packs,
  });
  const handleDownloads = createDownloadHandler({
    state,
    invoke,
    render,
    renderChrome,
    persist,
    flash,
    refreshJava: instances.versions.refreshJava,
    jobs,
  });
  const handleMultiplayer = createMultiplayerHandler({
    state,
    render,
    flash,
    copy: copyText,
    multiplayer,
  });
  const handleArchive = createArchiveHandler({ container, archive });
  const handleInstances = createInstanceHandler({
    container,
    state,
    invoke,
    render,
    renderOverlay,
    persist,
    flash,
    profile: instances.profile,
    manage: instances.manage,
    theme: instances.theme,
    launchSettings: instances.settings,
    versionDelete: instances.deletion,
    archive,
  });
  const handleLauncher = createLauncherHandler({
    state,
    invoke,
    render,
    renderOverlay,
    renderChrome,
    flash,
    showCrash,
    checkUpdate: system.checkLauncherUpdate,
    refresh: instances.versions.refresh,
    launch: launchGame,
    queueVersion: jobs.queueVersion,
  });
  installFormEvents({
    container,
    state,
    render,
    renderOverlay,
    renderMods: view.pages.content,
    syncMemory: view.syncMemory,
    updateSearch: view.pages.search,
    persist,
    pumpJobs: jobs.pumpJobs,
    addons: installAddons,
    theme: instances.theme,
    appearance,
    skin: account.skin,
    content: content.controls,
    instanceSettings: instances.settings,
    settings,
    multiplayer,
  });
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    const menu = container.querySelector<HTMLDetailsElement>('[data-home-version-menu][open]');
    if (!menu) return;
    menu.open = false;
    menu.querySelector<HTMLElement>('summary')?.focus();
  });
  installClickDispatcher({
    container,
    handlers: [
      handleShell,
      handleNavigation,
      handleInstances,
      handleContent,
      handleDownloads,
      handleMultiplayer,
      handleArchive,
      handleAccount,
      handleLauncher,
    ],
    beforeDispatch: (target) => {
      if (!target.closest('[data-theme-reset]')) closeVersionMenus(container, target);
      container
        .querySelectorAll<HTMLDetailsElement>('[data-home-version-menu][open]')
        .forEach((menu) => {
          if (!menu.contains(target) || target.closest('button')) menu.open = false;
        });
    },
    onError: (error) => flash(`操作失败：${error}`, 'error'),
  });
}
