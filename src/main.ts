import './style.css';
import './journal-theme.css';
import './multiplayer.css';
import './custom-theme.css';
import './launch-screen.css';
import './management.css';
import './update.css';
import './usability.css';

import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { version as appVersion } from '../package.json';
import { createAccountFeature } from './app/features/account';
import { createContentFeature } from './app/features/content';
import { createInstanceFeature } from './app/features/instances';
import { createApplicationView } from './app/view';
import { installApplicationEvents } from './app/events';
import { startApplication } from './app/startup';
import { createJobManager, type JobProgress } from './job-manager';
import { imageStore, validateThemeImage } from './lib/appearance';
import { createAppearanceController } from './lib/appearance-controller';
import { createArchiveManager } from './lib/archive-manager';
import { createContentInstall } from './lib/content-install';
import { createGameEvents, type WindowEvent, type ExitEvent } from './lib/game-events';
import { createGameLauncher } from './lib/game-launcher';
import { createGlobalSettings } from './lib/global-settings';
import {
  createInitialState,
  createTheme,
  persistSettings,
  readSettings,
  type LauncherState,
} from './lib/launcher-state';
import { createMultiplayer } from './lib/multiplayer';
import { createSystemStatus } from './lib/system-status';

// Restore settings before constructing the feature controllers.
const app = document.querySelector<HTMLElement>('#app')!;
const saved = readSettings(localStorage);
const state = createInitialState(saved);
const theme = createTheme(saved);
const persist = () => persistSettings(localStorage, state, theme);

// Controllers keep these callbacks, but do not render during construction.
// The view is connected below before events or application startup can call them.
const render = () => view.render();
const renderChrome = () => view.chrome();
const renderOverlay = () => view.overlay();
const applyTheme = () => appearance.apply();

function flash(message: string, kind = '') {
  state.notice = message;
  state.noticeKind = kind;
  state.noticeCrash = false;
  renderChrome();
}

function showCrash(crash: NonNullable<LauncherState['crash']>) {
  state.crash = crash;
  state.notice = `游戏 ${crash.version} 异常退出（代码 ${crash.code ?? '未知'}）。`;
  state.noticeKind = 'error';
  state.noticeCrash = true;
  renderChrome();
}

// Each feature owns its controller construction and backend command adapters.
const instances = createInstanceFeature({
  state,
  storage: localStorage,
  render,
  renderOverlay,
  renderChrome,
  applyTheme,
  persist,
  flash,
});
const account = createAccountFeature({
  container: app,
  state,
  storage: localStorage,
  render,
  renderChrome,
  persist,
  flash,
});
const content = createContentFeature({
  state,
  render,
  renderContent: () => view.pages.content(),
  renderOverlay,
  flash,
});
const appearance = createAppearanceController({
  theme,
  instanceColor: () => instances.theme.getTheme(state.gameDir, state.selected).color,
  instanceCover: () => instances.theme.getCover(state.gameDir, state.selected),
  store: imageStore,
  validate: validateThemeImage,
  flash,
});
const system = createSystemStatus({
  state,
  isDesktop: isTauri,
  getMemory: () => invoke('memory_info'),
  getUpdate: () => invoke('check_launcher_update'),
  renderMemory: () => {
    if (state.page === 'settings' && app.querySelector('#memory-info')) view.pages.settings();
  },
  renderChrome,
});
const multiplayer = createMultiplayer({
  state,
  render,
  flash,
  getAddresses: () => invoke('ipv6_addresses'),
  getServers: () => invoke('public_servers'),
  startRoom: (gamePort) => invoke('start_ipv6_room', { gamePort }),
  stopRoom: () => invoke('stop_ipv6_room'),
  testConnection: (address) => invoke('test_ipv6_connection', { address }),
});

// Cross-feature operations connect downloads, account restoration and instances.
const jobs = createJobManager({
  state,
  invoke,
  persist,
  renderChrome,
  flash,
  render,
  refreshInstalled: instances.versions.refreshInstalled,
  renderDownloads: () => view.pages.downloads(),
  onJobFinished: content.onJobFinished,
});
const contentInstall = createContentInstall({
  state,
  render: renderOverlay,
  enqueue: jobs.enqueueJob,
  runnerFor: jobs.runnerFor,
  openDetails: content.detail.open,
  installModpack: (args) => invoke('install_modpack', args),
  installMod: (args) => invoke('install_mod', args),
});
const archive = createArchiveManager({
  state,
  render: renderOverlay,
  persist,
  flash,
  enqueue: jobs.enqueueJob,
  chooseImport: () =>
    openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: 'CCL 或 PCL 兼容整合包', extensions: ['zip', 'mrpack'] }],
    }),
  chooseExport: (version, format) =>
    saveDialog({
      defaultPath: `CCL-${version}.${format === 'pcl' ? 'mrpack' : 'zip'}`,
      filters: [
        {
          name: format === 'pcl' ? 'PCL 兼容整合包' : 'CCL 游戏导出包',
          extensions: [format === 'pcl' ? 'mrpack' : 'zip'],
        },
      ],
    }),
  inspect: (path) => invoke('inspect_game_archive', { path }),
  exportGame: (args) => invoke('export_game', args),
  importGame: (args) => invoke('import_game', args),
});
const settings = createGlobalSettings({
  state,
  render,
  persist,
  flash,
  invalidateMods: content.mods.invalidate,
  refresh: instances.versions.refresh,
  configureProxy: (proxyUrl) => invoke('configure_proxy', { proxyUrl }),
  setIsolation: (gameDir, version, isolated) =>
    invoke('set_version_isolation', { gameDir, version, isolated }),
});
const launchGame = createGameLauncher({
  state,
  isOnline: account.usingOnline,
  restoreAccount: () => account.restore({ notify: false }),
  shouldApplySkin: account.skin.shouldApply,
  applySkin: (gameDir, version, username, skin) =>
    invoke('apply_offline_skin', { gameDir, version, username, skin }),
  settings: instances.settings.effective,
  launch: (options) => invoke('launch_game', { options }),
  render: renderOverlay,
  flash,
});
const gameEvents = createGameEvents({
  state,
  render,
  renderOverlay,
  showCrash,
  refreshStats: instances.profile.loadStats,
});

// Connect rendering and user interactions before starting asynchronous work.
const view = createApplicationView({
  container: app,
  state,
  theme,
  appVersion,
  account,
  instances,
  jobs,
  multiplayer,
  applyTheme,
  persist,
});
installApplicationEvents({
  container: app,
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
});

void startApplication({
  state,
  isDesktop: isTauri,
  updateBanner: appearance.updateDefaultBanner,
  restoreJobs: jobs.restoreJobs,
  render,
  restoreTheme: appearance.restore,
  restoreSkin: account.avatars.restoreLocalSkin,
  isOnline: account.usingOnline,
  restoreAvatar: account.avatars.restoreOnlineAvatar,
  configureProxy: (proxyUrl) => invoke('configure_proxy', { proxyUrl }),
  defaultGameDir: () => invoke('default_game_dir'),
  listenProgress: (name, handler) => listen<JobProgress>(name, handler),
  listenWindow: (name, handler) => listen<WindowEvent>(name, handler),
  listenExit: (handler) => listen<ExitEvent>('game-exit', handler),
  jobEvent: jobs.jobEvent,
  gameEvents,
  checkUpdate: system.checkLauncherUpdate,
  restoreAccount: () => account.restore({ notify: false }),
  refresh: instances.versions.refresh,
  flash,
});
