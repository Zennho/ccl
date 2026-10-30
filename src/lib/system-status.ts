export interface MemoryInfo {
  totalMb: number;
  availableMb: number;
  recommendedMb?: number;
}
export interface UpdateInfo {
  available: boolean;
  latestVersion: string;
}
interface State {
  page: string;
  memoryInfoLoading: boolean;
  memoryInfoError: string;
  memoryInfo: MemoryInfo | null;
  updateState: string;
  updateError: string;
  updateInfo: UpdateInfo | null;
  updateDismissed: string;
}
interface Options {
  state: State;
  isDesktop: () => boolean;
  getMemory: () => Promise<MemoryInfo>;
  getUpdate: () => Promise<UpdateInfo>;
  renderMemory: () => void;
  renderChrome: () => void;
}
export function createSystemStatus({
  state,
  isDesktop,
  getMemory,
  getUpdate,
  renderMemory,
  renderChrome,
}: Options) {
  async function refreshMemoryInfo() {
    if (state.memoryInfoLoading || !isDesktop()) return;
    state.memoryInfoLoading = true;
    state.memoryInfoError = '';
    renderMemory();
    try {
      const info = await getMemory();
      if (!info || !Number.isFinite(info.totalMb) || !Number.isFinite(info.availableMb))
        throw new Error('内存信息不可用');
      state.memoryInfo = info;
    } catch (error) {
      state.memoryInfo = null;
      state.memoryInfoError = String(error);
    } finally {
      state.memoryInfoLoading = false;
      renderMemory();
    }
  }
  async function checkLauncherUpdate(manual = false) {
    if (state.updateState === 'checking') return;
    state.updateState = 'checking';
    state.updateError = '';
    renderChrome();
    try {
      const info = await getUpdate();
      if (!info || typeof info.available !== 'boolean' || typeof info.latestVersion !== 'string')
        throw new Error('更新信息格式无效');
      state.updateInfo = info;
      state.updateState = 'success';
      if (manual && info.available) state.updateDismissed = '';
    } catch (error) {
      state.updateState = 'error';
      state.updateError = String(error);
    }
    renderChrome();
  }
  return { refreshMemoryInfo, checkLauncherUpdate };
}
