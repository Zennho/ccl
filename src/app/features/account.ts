import type { LauncherState } from '../../lib/launcher-state';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { imageStore } from '../../lib/appearance';
import { createAvatarStore } from '../../lib/avatar-store';
import { createAccountAppearance } from '../../lib/account-appearance';
import { createAccountRestorer } from '../../lib/account-restore';
import { createAccountActions } from '../../lib/account-actions';
import { createSkinController } from '../../lib/skin-controller';

interface Options {
  container: HTMLElement;
  state: LauncherState;
  storage: Storage;
  render: () => void;
  renderChrome: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
}

export type AccountFeature = ReturnType<typeof createAccountFeature>;

export function createAccountFeature({
  container,
  state,
  storage,
  render,
  renderChrome,
  persist,
  flash,
}: Options) {
  const usingOnlineAccount = () =>
    state.accountPreference === 'microsoft' && (state.accountKnown || !!state.account);
  const playerName = () =>
    usingOnlineAccount() ? state.account?.name || state.accountName || '正版账户' : state.username;
  function playerStatus() {
    if (!usingOnlineAccount()) return '离线玩家';
    if (state.account) return '微软账户';
    return state.accountRestoring ? '正在验证正版账户' : '正版账户 · 待验证';
  }

  const avatarStore = createAvatarStore({ state, store: imageStore, render, renderChrome, flash });

  const accountAppearance = createAccountAppearance({
    state,
    container,
    render,
    renderChrome,
    flash,
    cacheAvatar: avatarStore.cacheOnlineAvatar,
    getAccounts: () => invoke('list_microsoft_accounts'),
    getAppearance: () => invoke('get_appearance'),
    createPreview: (canvas, skin, cape, model) =>
      import('../../appearance-preview').then((preview) =>
        preview.createAppearancePreview(canvas, skin, cape, model),
      ),
  });
  const restoreAccount = createAccountRestorer({
    state,
    restore: () => invoke('restore_microsoft_account'),
    restoreAvatar: avatarStore.restoreOnlineAvatar,
    refreshAppearance: () => accountAppearance.refreshAppearance({ reuse: true }),
    render,
    persist,
    flash,
  });
  const accountActions = createAccountActions({
    state,
    render,
    persist,
    flash,
    restore: restoreAccount,
    restoreAvatar: avatarStore.restoreOnlineAvatar,
    cacheAvatar: avatarStore.cacheOnlineAvatar,
    refreshAppearance: accountAppearance.refreshAppearance,
    refreshAccounts: accountAppearance.refreshAccountList,
    switchAccount: (uuid) => invoke('switch_microsoft_account', { uuid }),
    beginLogin: () => invoke('begin_microsoft_login'),
    completeLogin: () => invoke('complete_microsoft_login'),
    cancelLogin: () => invoke('cancel_microsoft_login'),
    remember: () => invoke('remember_microsoft_account'),
    openLogin: () => invoke('open_microsoft_login'),
    logout: () => invoke('logout_microsoft'),
  });
  const skinController = createSkinController({
    state,
    storage,
    isOnline: usingOnlineAccount,
    render,
    flash,
    saveSkin: avatarStore.saveLocalSkin,
    refreshAppearance: accountAppearance.refreshAppearance,
    chooseFile: () =>
      openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      }),
    previewTexture: (path, kind) => invoke('preview_texture', { path, kind }),
    applyOffline: (gameDir, version, username, skin) =>
      invoke('apply_offline_skin', { gameDir, version, username, skin }),
    uploadSkin: (path, model) => invoke('upload_account_skin', { path, model }),
    resetSkin: () => invoke('reset_account_skin'),
    setCape: (capeId) => invoke('set_account_cape', { capeId }),
  });

  function playerSkin() {
    const uuid = state.account?.uuid || state.accountUuid;
    const skin = usingOnlineAccount()
      ? state.appearance?.skin || avatarStore.get(uuid)
      : state.localSkin?.data;
    return typeof skin === 'string' && skin.startsWith('data:image/png;base64,') ? skin : '';
  }

  return {
    avatars: avatarStore,
    appearance: accountAppearance,
    actions: accountActions,
    skin: skinController,
    restore: restoreAccount,
    usingOnline: usingOnlineAccount,
    playerName,
    playerStatus,
    playerSkin,
  };
}
