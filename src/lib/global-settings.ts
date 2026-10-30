import type { GameVersion, InstanceLaunchOptions } from '../react/types';
interface State extends InstanceLaunchOptions {
  username: string;
  proxyUrl: string;
  gameDir: string;
  versions: GameVersion[];
  selected: string;
  jobs: { gameDir?: string; status: string }[];
  localMods: unknown[];
  contentResults: unknown[];
  contentLoaded: boolean;
  modUpdates: unknown;
  modConflicts: unknown;
  selectedMods: Set<string>;
}
interface Options {
  state: State;
  render: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
  invalidateMods: () => void;
  refresh: () => Promise<unknown>;
  configureProxy: (proxyUrl: string) => Promise<unknown>;
  setIsolation: (gameDir: string, version: string, isolated: boolean) => Promise<unknown>;
}
export function createGlobalSettings({
  state,
  render,
  persist,
  flash,
  invalidateMods,
  refresh,
  configureProxy,
  setIsolation,
}: Options) {
  async function save(form: HTMLFormElement) {
    const data = new FormData(form),
      proxyUrl = String(data.get('proxyUrl') || '').trim(),
      gameDir = String(data.get('gameDir') || '').trim();
    const changed = state.gameDir !== gameDir || state.proxyUrl !== proxyUrl,
      version = state.versions.find((v) => v.id === state.selected && v.installed),
      isolation = form.querySelector<HTMLInputElement>('#version-isolation');
    const isolationChanged =
      version && isolation && !isolation.disabled && isolation.checked !== !!version.isolated;
    if (isolationChanged && state.gameDir !== gameDir) {
      flash('请先保存游戏目录，再修改版本隔离。', 'error');
      return;
    }
    if (
      isolationChanged &&
      state.jobs.some(
        (job) =>
          job.gameDir === state.gameDir && ['queued', 'running', 'canceling'].includes(job.status),
      )
    ) {
      flash('该游戏目录有进行中或等待中的任务，请先取消或等待结束。', 'error');
      return;
    }
    try {
      await configureProxy(proxyUrl);
    } catch (error) {
      const input = form.querySelector<HTMLInputElement>('#proxyUrl');
      if (input) {
        input.setCustomValidity(String(error));
        input.reportValidity();
      }
      return;
    }
    if (isolationChanged && version && isolation) {
      try {
        await setIsolation(state.gameDir, version.id, isolation.checked);
        version.isolated = isolation.checked;
        state.localMods = [];
        state.contentResults = [];
        state.contentLoaded = false;
        state.modUpdates = null;
        state.selectedMods.clear();
        invalidateMods();
      } catch (error) {
        flash(`无法修改版本隔离：${error}`, 'error');
        return;
      }
    }
    Object.assign(state, {
      username: String(data.get('username') || '').trim(),
      javaPath: String(data.get('javaPath') || '').trim(),
      proxyUrl,
      gameDir,
      memory: Number(data.get('memory') ?? state.memory),
      memoryMode: data.get('memoryMode') === 'auto' ? 'auto' : 'manual',
      optimize: data.has('optimize'),
      jvmArgs: String(data.get('jvmArgs') || ''),
      gameArgs: String(data.get('gameArgs') || ''),
    });
    persist();
    if (changed) {
      state.selectedMods.clear();
      state.modUpdates = null;
      state.modConflicts = null;
      invalidateMods();
    }
    render();
    flash('设置已保存。');
    if (changed) await refresh();
  }
  return { save };
}
