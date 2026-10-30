import type { invoke } from '@tauri-apps/api/core';
import type { LauncherState } from '../../lib/launcher-state';
import type { ClickHandler } from './types';
interface Options {
  state: LauncherState;
  invoke: typeof invoke;
  render: () => void;
  renderOverlay: () => void;
  renderChrome: () => void;
  flash: (message: string, kind?: string) => void;
  showCrash: (crash: NonNullable<LauncherState['crash']>) => void;
  checkUpdate: (manual: boolean) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  launch: () => Promise<unknown>;
  queueVersion: (draft: { version: string; loader: string; addons: string[] }) => void;
}
export function createLauncherHandler({
  state,
  invoke,
  render,
  renderOverlay,
  renderChrome,
  flash,
  showCrash,
  checkUpdate,
  refresh,
  launch,
  queueVersion,
}: Options): ClickHandler {
  async function openLog(crashLog: boolean) {
    const crash = state.crashDialog || state.launchView?.crash || state.crash,
      version = crashLog ? crash?.version : state.selected,
      gameDir = crashLog ? crash?.gameDir : state.gameDir;
    if (!version) return;
    try {
      if (crashLog && !crash?.logName) throw new Error('无法确定本次启动的日志文件');
      await invoke('open_game_log', {
        gameDir,
        version,
        logName: crashLog ? crash?.logName : null,
      });
    } catch (error) {
      flash(String(error), 'error');
    }
  }
  return (target) => {
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'close-launch-view': {
        const crash = state.launchView?.crash;
        state.launchView = null;
        if (crash?.diagnosis) showCrash(crash);
        renderOverlay();
        return true;
      }
      case 'launch-account':
        state.launchView = null;
        state.page = 'account';
        render();
        return true;
      case 'check-update':
        void checkUpdate(true);
        return true;
      case 'open-update':
        return (async () => {
          try {
            await invoke('open_launcher_releases');
          } catch (error) {
            flash(`无法打开下载页面：${error}`, 'error');
          }
        })();
      case 'dismiss-update':
        state.updateDismissed = state.updateInfo?.latestVersion || '';
        renderChrome();
        return true;
      case 'dismiss':
        state.notice = '';
        state.noticeCrash = false;
        renderChrome();
        return true;
      case 'open-crash-diagnosis':
        if (state.crash) {
          state.crashDialog = state.crash;
          renderOverlay();
        }
        return true;
      case 'close-crash-dialog':
        state.crashDialog = null;
        renderOverlay();
        return true;
      case 'open-log':
        return openLog(false);
      case 'open-crash-log':
        return openLog(true);
      case 'close-install':
        state.installDraft = null;
        renderOverlay();
        return true;
      case 'close-install-backdrop':
        if (target.classList.contains('install-overlay')) {
          state.installDraft = null;
          renderOverlay();
        }
        return true;
      case 'confirm-install':
        if (
          state.installDraft &&
          (state.installDraft.loader === 'vanilla' ||
            !['checking', 'unavailable'].includes(
              state.installDraft.compatibility[state.installDraft.loader],
            ))
        ) {
          const { version, loader, addons } = state.installDraft;
          const draft = { version, loader, addons: [...addons] };
          state.installDraft = null;
          renderOverlay();
          queueVersion(draft);
        }
        return true;
      case 'refresh':
        return refresh().then(() => {});
      case 'launch':
        return launch().then(() => {});
      default:
        return false;
    }
  };
}
