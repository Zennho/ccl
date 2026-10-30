import { instanceKey } from './instance-theme';
import type { LocalSkin } from './avatar-store';
import type { GameVersion } from '../react/types';
type TextureKind = 'skin' | 'cape';
interface State {
  account: unknown;
  accountBusy: boolean;
  localSkin: LocalSkin | null;
  localCape: { path: string; data: string; name: string } | null;
  appearance: { capes: { id: string }[] } | null;
  previewCapeId: string;
  skinModel: string;
  selected: string;
  gameDir: string;
  username: string;
  versions: GameVersion[];
}
interface Options {
  state: State;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  isOnline: () => boolean;
  render: () => void;
  flash: (message: string, kind?: string) => void;
  saveSkin: (skin: LocalSkin | null) => void;
  refreshAppearance: () => Promise<unknown>;
  chooseFile: () => Promise<string | null>;
  previewTexture: (path: string, kind: TextureKind) => Promise<string>;
  applyOffline: (
    gameDir: string,
    version: string,
    username: string,
    skin: string,
  ) => Promise<unknown>;
  uploadSkin: (path: string, model: string) => Promise<unknown>;
  resetSkin: () => Promise<unknown>;
  setCape: (capeId: string | null) => Promise<unknown>;
}
export function createSkinController({
  state,
  storage,
  isOnline,
  render,
  flash,
  saveSkin,
  refreshAppearance,
  chooseFile,
  previewTexture,
  applyOffline,
  uploadSkin,
  resetSkin,
  setCape,
}: Options) {
  let offlineInstances: Record<string, boolean> = {};
  try {
    const value = JSON.parse(storage.getItem('ccl-offline-skin-instances') || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) offlineInstances = value;
  } catch {}
  async function choose(kind: TextureKind) {
    try {
      const path = await chooseFile();
      if (typeof path !== 'string') return;
      const data = await previewTexture(path, kind),
        file = { path, data, name: path.split(/[\\/]/).pop() || '' };
      if (kind === 'skin') {
        state.localSkin = { ...file, model: state.skinModel };
        saveSkin(state.localSkin);
      } else state.localCape = file;
      render();
    } catch (error) {
      flash(`无法预览图片：${error}`, 'error');
    }
  }
  async function applyToOffline() {
    if (
      !state.localSkin ||
      isOnline() ||
      !state.versions.some((v) => v.id === state.selected && v.installed)
    )
      return;
    const version = state.selected,
      gameDir = state.gameDir,
      skin = state.localSkin.data,
      username = state.username;
    state.accountBusy = true;
    render();
    try {
      await applyOffline(gameDir, version, username, skin);
      offlineInstances[instanceKey(gameDir, version)] = true;
      storage.setItem('ccl-offline-skin-instances', JSON.stringify(offlineInstances));
      flash('皮肤已保存到实例；请确保已安装 CustomSkinLoader。');
    } catch (error) {
      flash(`无法应用离线皮肤：${error}`, 'error');
    } finally {
      state.accountBusy = false;
      render();
    }
  }
  function clearSkin() {
    state.localSkin = null;
    saveSkin(null);
    render();
  }
  function clearCape() {
    state.localCape = null;
    render();
  }
  function setModel(model: string) {
    state.skinModel = model;
    if (state.localSkin) {
      state.localSkin.model = model;
      saveSkin(state.localSkin);
    }
    render();
  }
  async function upload() {
    if (!state.localSkin || !state.account) return;
    const skin = state.localSkin;
    state.accountBusy = true;
    render();
    try {
      await uploadSkin(skin.path, state.skinModel);
      state.localSkin = null;
      saveSkin(null);
      await refreshAppearance();
      flash('皮肤已应用到正版账户。');
    } catch (error) {
      flash(`应用皮肤失败：${error}`, 'error');
    }
    state.accountBusy = false;
    render();
  }
  async function reset() {
    if (!state.account) return;
    state.accountBusy = true;
    render();
    try {
      await resetSkin();
      state.localSkin = null;
      saveSkin(null);
      await refreshAppearance();
      flash('已恢复账户默认皮肤。');
    } catch (error) {
      flash(`恢复皮肤失败：${error}`, 'error');
    }
    state.accountBusy = false;
    render();
  }
  async function hideCape() {
    if (!state.account) return;
    state.accountBusy = true;
    render();
    try {
      await setCape(null);
      state.localCape = null;
      await refreshAppearance();
      flash('已隐藏账户披风。');
    } catch (error) {
      flash(`更新披风失败：${error}`, 'error');
    }
    state.accountBusy = false;
    render();
  }
  function previewCape(index: number) {
    const cape = state.appearance?.capes[index];
    if (cape) {
      state.previewCapeId = cape.id;
      state.localCape = null;
      render();
    }
  }
  async function applyCape(index: number) {
    const cape = state.appearance?.capes[index];
    if (!cape || !state.account) return;
    state.accountBusy = true;
    render();
    try {
      await setCape(cape.id);
      state.localCape = null;
      await refreshAppearance();
      flash('已更新账户披风。');
    } catch (error) {
      flash(`更新披风失败：${error}`, 'error');
    }
    state.accountBusy = false;
    render();
  }
  return {
    choose,
    applyToOffline,
    clearSkin,
    clearCape,
    setModel,
    upload,
    reset,
    hideCape,
    previewCape,
    applyCape,
    shouldApply: (gameDir: string, version: string) =>
      offlineInstances[instanceKey(gameDir, version)] === true,
  };
}
