import type { LauncherState } from '../../lib/launcher-state';
import { invoke } from '@tauri-apps/api/core';
import { imageStore, validateThemeImage } from '../../lib/appearance';
import { createInstanceLaunchSettings } from '../../lib/instance-launch-settings';
import { createInstanceTheme } from '../../lib/instance-theme';
import { createGameProfile } from '../../lib/game-profile';
import { createInstanceManage } from '../../lib/instance-manage';
import { createVersionManager } from '../../lib/version-manager';
import { createVersionDelete } from '../../lib/version-delete';

interface Options {
  state: LauncherState;
  storage: Storage;
  render: () => void;
  renderOverlay: () => void;
  renderChrome: () => void;
  applyTheme: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
}

export type InstanceFeature = ReturnType<typeof createInstanceFeature>;

export function createInstanceFeature({
  state,
  storage,
  render,
  renderOverlay,
  renderChrome,
  applyTheme,
  persist,
  flash,
}: Options) {
  const instanceLaunch = createInstanceLaunchSettings({
    state,
    storage,
    render: renderOverlay,
    flash,
  });

  const instanceTheme = createInstanceTheme({
    state,
    storage,
    store: imageStore,
    validate: validateThemeImage,
    render,
    renderOverlay,
    applyTheme,
    flash,
  });

  const gameProfile = createGameProfile({
    state,
    render: renderOverlay,
    list: (gameDir, version, page) => invoke('list_game_screenshots', { gameDir, version, page }),
    screenshot: (gameDir, version, name) => invoke('game_screenshot', { gameDir, version, name }),
    stats: (gameDir, version) => invoke('play_stats', { gameDir, version }),
  });

  const instanceManage = createInstanceManage({
    state,
    render: renderOverlay,
    flash,
    list: (kind, gameDir, version) =>
      invoke(kind === 'backups' ? 'list_backups' : 'list_worlds', { gameDir, version }),
    operation: (command, args) => invoke(command, args),
  });
  const versionManager = createVersionManager({
    state,
    render,
    renderChrome,
    persist,
    loadCovers: instanceTheme.loadInstalled,
    flash,
    listVersions: (gameDir) => invoke('list_versions', { gameDir }),
    installed: (gameDir) => invoke('installed_versions', { gameDir }),
    listJava: () => invoke('list_java'),
  });

  const versionDelete = createVersionDelete({
    state,
    render,
    persist,
    flash,
    refreshInstalled: versionManager.refreshInstalled,
    remove: (gameDir, version, removeInstance) =>
      invoke('delete_version', { gameDir, version, removeInstance }),
  });

  return {
    settings: instanceLaunch,
    theme: instanceTheme,
    profile: gameProfile,
    manage: instanceManage,
    versions: versionManager,
    deletion: versionDelete,
  };
}
