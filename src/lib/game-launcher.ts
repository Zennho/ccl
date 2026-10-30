import type { LaunchView } from '../react/launch';
import type { InstanceLaunchOptions } from '../react/types';
interface State {
  selected: string;
  username: string;
  gameDir: string;
  account: unknown;
  accountPreference: string;
  accountRestoreError: string;
  localSkin: { data: string } | null;
  launchView: LaunchView | null;
  crashDialog: unknown;
}
interface Options {
  state: State;
  isOnline: () => boolean;
  restoreAccount: () => Promise<unknown>;
  shouldApplySkin: (gameDir: string, version: string) => boolean;
  applySkin: (gameDir: string, version: string, username: string, skin: string) => Promise<unknown>;
  settings: (gameDir: string, version: string) => InstanceLaunchOptions;
  launch: (
    options: InstanceLaunchOptions & {
      launchId: string;
      version: string;
      username: string;
      gameDir: string;
      accountMode: string;
    },
  ) => Promise<unknown>;
  render: () => void;
  flash: (message: string, kind?: string) => void;
}
export function createGameLauncher({
  state,
  isOnline,
  restoreAccount,
  shouldApplySkin,
  applySkin,
  settings,
  launch,
  render,
  flash,
}: Options) {
  let sequence = 0;
  return async function launchGame() {
    if (state.launchView) return;
    const online = isOnline(),
      view: LaunchView = {
        id: `${Date.now()}-${++sequence}`,
        version: state.selected,
        phase: online && !state.account ? 'authenticating' : 'preparing',
        error: '',
        warning: '',
        authError: false,
      };
    state.launchView = view;
    state.crashDialog = null;
    render();
    try {
      if (online && !state.account) {
        const account = await restoreAccount();
        if (state.launchView !== view) return;
        if (state.accountPreference !== 'microsoft')
          throw new Error('账户模式已更改，请重新启动游戏。');
        if (!account) {
          view.authError = true;
          throw new Error(
            state.accountRestoreError || '无法恢复正版账户，请前往账户页面重新登录。',
          );
        }
        view.phase = 'preparing';
        render();
      }
      if (state.launchView !== view) return;
      if (!online && state.localSkin?.data && shouldApplySkin(state.gameDir, view.version))
        await applySkin(state.gameDir, view.version, state.username, state.localSkin.data);
      if (state.launchView !== view) return;
      const options = settings(state.gameDir, view.version);
      await launch({
        ...options,
        launchId: view.id,
        version: view.version,
        username: state.username,
        gameDir: state.gameDir,
        memory: Number(options.memory),
        accountMode: online ? 'microsoft' : 'offline',
      });
      if (state.launchView === view && view.phase === 'preparing') {
        view.phase = 'waiting';
        render();
      }
    } catch (error) {
      if (state.launchView === view) {
        view.phase = 'failed';
        view.error = String(error);
        if (online && /微软|Xbox|正版|登录|账户|授权/i.test(view.error)) view.authError = true;
        render();
      } else flash(`启动失败：${error}`, 'error');
    }
  };
}
