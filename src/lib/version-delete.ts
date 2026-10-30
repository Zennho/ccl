import type { GameVersion } from '../react/types';
export interface VersionDelete {
  id: string;
  name: string;
  isolated: boolean;
  gameDir: string;
}
interface State {
  gameDir: string;
  versions: GameVersion[];
  versionDelete: VersionDelete | null;
  versionDeleting: boolean;
  selected: string;
  contentTarget: string;
  localMods: unknown[];
  contentResults: unknown[];
  jobs: { gameDir?: string; status: string }[];
}
interface Options {
  state: State;
  render: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
  refreshInstalled: (gameDir: string) => Promise<unknown>;
  remove: (gameDir: string, version: string, removeInstance: boolean) => Promise<unknown>;
}
export function createVersionDelete({
  state,
  render,
  persist,
  flash,
  refreshInstalled,
  remove,
}: Options) {
  function open(id: string) {
    const version = state.versions.find((v) => v.id === id && v.installed);
    if (!version) return;
    state.versionDelete = {
      id: version.id,
      name: version.name || version.id,
      isolated: !!(version.isolated || version.hasInstanceData),
      gameDir: state.gameDir,
    };
    render();
  }
  function cancel() {
    state.versionDelete = null;
    render();
  }
  async function confirm(removeInstance: boolean) {
    const draft = state.versionDelete;
    if (!draft || state.versionDeleting) return;
    if (
      state.jobs.some(
        (job) =>
          job.gameDir === draft.gameDir && ['queued', 'running', 'canceling'].includes(job.status),
      )
    ) {
      flash('该游戏目录有进行中或等待中的任务，请先取消或等待结束。', 'error');
      return;
    }
    state.versionDeleting = true;
    render();
    try {
      await remove(draft.gameDir, draft.id, removeInstance);
      state.versionDelete = null;
      if (state.selected === draft.id) state.selected = '';
      if (state.contentTarget === draft.id) {
        state.contentTarget = '';
        state.localMods = [];
        state.contentResults = [];
      }
      await refreshInstalled(draft.gameDir);
      persist();
      flash('版本已删除。');
    } catch (error) {
      flash(`删除失败：${error}`, 'error');
    } finally {
      state.versionDeleting = false;
      render();
    }
  }
  return { open, cancel, confirm };
}
