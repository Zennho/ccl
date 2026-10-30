import type { Crash, Diagnosis, LaunchView } from '../react/launch';
import type { ProfileView } from './game-profile';
interface GameCrash extends Crash {
  gameDir: string;
  logName: string | null;
}
interface State {
  page: string;
  launchView: LaunchView | null;
  profileView: ProfileView | null;
}
export interface WindowEvent {
  launchId: string;
  status?: string;
}
export interface ExitEvent {
  launchId?: string;
  version: string;
  gameDir: string;
  success: boolean;
  logPath?: string;
  code?: number | null;
  diagnosis?: Diagnosis | null;
}
interface Options {
  state: State;
  render: () => void;
  renderOverlay: () => void;
  showCrash: (crash: GameCrash) => void;
  refreshStats: (view: ProfileView) => Promise<unknown>;
}
export function createGameEvents({
  state,
  render,
  renderOverlay,
  showCrash,
  refreshStats,
}: Options) {
  return {
    windowReady(payload: WindowEvent) {
      const view = state.launchView;
      if (view && view.phase !== 'failed' && payload.launchId === view.id) {
        state.launchView = null;
        state.page = 'home';
        render();
      }
    },
    windowStatus(payload: WindowEvent) {
      const view = state.launchView;
      if (view && view.phase !== 'failed' && payload.launchId === view.id) {
        view.warning =
          payload.status === 'unavailable'
            ? '当前桌面暂时无法确认游戏窗口；窗口出现后可手动返回主页。'
            : '等待时间较长，可查看启动日志或手动返回主页。';
        renderOverlay();
      }
    },
    exit(payload: ExitEvent) {
      const view = state.launchView,
        profile = state.profileView;
      if (profile && profile.version === payload.version && profile.gameDir === payload.gameDir)
        void refreshStats(profile);
      const sameLaunch =
        view &&
        (payload.launchId ? view.id === payload.launchId : view.version === payload.version);
      if (!payload.success || sameLaunch) {
        const crash: GameCrash = {
          version: payload.version,
          gameDir: payload.gameDir,
          logName:
            typeof payload.logPath === 'string'
              ? payload.logPath.split(/[\\/]/).pop() || null
              : null,
          code: payload.code,
          diagnosis: payload.success ? null : payload.diagnosis,
        };
        if (sameLaunch && view) {
          view.crash = crash;
          view.phase = 'failed';
          view.error = payload.success
            ? '游戏进程已退出，未检测到游戏窗口。可以打开启动日志查看详情。'
            : `游戏异常退出（代码 ${payload.code ?? '未知'}），可以打开启动日志查看详情。`;
          renderOverlay();
        } else if (!payload.success) showCrash(crash);
      }
    },
  };
}
