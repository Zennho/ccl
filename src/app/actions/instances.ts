import type { invoke } from '@tauri-apps/api/core';
import type { LauncherState } from '../../lib/launcher-state';
import type { createGameProfile } from '../../lib/game-profile';
import type { createInstanceManage } from '../../lib/instance-manage';
import type { createInstanceTheme } from '../../lib/instance-theme';
import type { createInstanceLaunchSettings } from '../../lib/instance-launch-settings';
import type { createVersionDelete } from '../../lib/version-delete';
import type { createArchiveManager } from '../../lib/archive-manager';
import type { ClickHandler } from './types';

interface Options {
  container: HTMLElement;
  state: LauncherState;
  invoke: typeof invoke;
  render: () => void;
  renderOverlay: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
  profile: ReturnType<typeof createGameProfile>;
  manage: ReturnType<typeof createInstanceManage>;
  theme: ReturnType<typeof createInstanceTheme>;
  launchSettings: ReturnType<typeof createInstanceLaunchSettings>;
  versionDelete: ReturnType<typeof createVersionDelete>;
  archive: ReturnType<typeof createArchiveManager>;
}
export function createInstanceHandler(options: Options): ClickHandler {
  const { container, state, invoke, render, renderOverlay, flash, profile, manage, theme } =
    options;
  async function openSettings(version: string, button: HTMLElement) {
    const item = state.versions.find((v) => v.id === version && v.installed);
    if (!item) return;
    const menu = button.closest('details');
    if (menu) menu.open = false;
    const view = { version, gameDir: state.gameDir, name: item.name || version };
    state.instanceSettingsView = view;
    renderOverlay();
    try {
      const runtimes = await invoke('list_java');
      if (state.instanceSettingsView === view && Array.isArray(runtimes)) {
        state.javaRuntimes = runtimes;
        renderOverlay();
      }
    } catch {
      /* Existing options remain usable when detection fails. */
    }
  }
  async function openOverview(version: string) {
    const gameDir = state.gameDir,
      item = state.versions.find((v) => v.id === version && v.installed);
    if (!item) return;
    const view: NonNullable<LauncherState['instanceView']> = {
      version,
      gameDir,
      name: item.name || version,
      loading: true,
      info: null,
      error: '',
    };
    state.instanceView = view;
    renderOverlay();
    try {
      const info = await invoke<NonNullable<LauncherState['instanceView']>['info']>(
        'instance_overview',
        { gameDir, version },
      );
      if (state.instanceView === view) view.info = info;
    } catch (error) {
      if (state.instanceView === view) view.error = String(error);
    } finally {
      if (state.instanceView === view) {
        view.loading = false;
        renderOverlay();
      }
    }
  }
  async function openWorld(folder: string | null) {
    const view = state.manageView;
    if (!view) return;
    try {
      await invoke('open_world_folder', { gameDir: view.gameDir, version: view.version, folder });
    } catch (error) {
      view.error = String(error);
      renderOverlay();
    }
  }
  async function confirmManage() {
    const view = state.manageView,
      choice = view?.confirm;
    if (!view || !choice || view.busy) return;
    if (choice.action === 'restore')
      await manage.perform(
        'restore_backup',
        { backupId: choice.item.id },
        '备份已恢复，恢复前的实例也已备份。',
      );
    else if (view.kind === 'backups')
      await manage.perform('delete_backup', { backupId: choice.item.id }, '备份已删除。');
    else
      await manage.perform(
        'delete_world',
        { folder: choice.item.folder },
        '存档已删除，并已创建备份。',
      );
  }
  return (target) => {
    const profileButton = target.closest<HTMLElement>('[data-game-profile]');
    if (profileButton) return profile.open(profileButton.dataset.gameProfile || '');
    const profilePage = target.closest<HTMLElement>('[data-profile-page]');
    if (profilePage && state.profileView && !state.profileView.loading) {
      const view = state.profileView,
        page = Number(profilePage.dataset.profilePage);
      if (page >= 0 && (page < view.page || view.hasMore)) {
        view.page = page;
        view.preview = null;
        return profile.loadScreenshots(view);
      }
      return true;
    }
    const shot = target.closest<HTMLElement>('[data-profile-shot]');
    if (shot && state.profileView) {
      const view = state.profileView,
        index = Number(shot.dataset.profileShot),
        data = view.images[index];
      if (data) {
        view.preview = { data, name: view.shots[index].name };
        renderOverlay();
      }
      return true;
    }
    const settings = target.closest<HTMLElement>('[data-instance-settings]');
    if (settings) return openSettings(settings.dataset.instanceSettings || '', settings);
    const themeButton = target.closest<HTMLElement>('[data-instance-theme]');
    if (themeButton) return theme.open(themeButton.dataset.instanceTheme || '');
    const color = target.closest<HTMLElement>('[data-instance-color]');
    if (color && state.themeView) {
      theme.setColor(color.dataset.instanceColor || '');
      return true;
    }
    const manageButton = target.closest<HTMLElement>('[data-manage-backups],[data-manage-worlds]');
    if (manageButton)
      return manage.open(
        manageButton.hasAttribute('data-manage-backups') ? 'backups' : 'worlds',
        manageButton.dataset.manageBackups || manageButton.dataset.manageWorlds || '',
      );
    const restore = target.closest<HTMLElement>('[data-manage-restore]');
    if (restore && state.manageView && !state.manageView.busy) {
      const item = state.manageView.items[Number(restore.dataset.manageRestore)];
      if (item) {
        state.manageView.confirm = { action: 'restore', item };
        renderOverlay();
      }
      return true;
    }
    const remove = target.closest<HTMLElement>('[data-manage-delete]');
    if (remove && state.manageView && !state.manageView.busy) {
      const item = state.manageView.items[Number(remove.dataset.manageDelete)];
      if (item) {
        state.manageView.confirm = { action: 'delete', item };
        renderOverlay();
      }
      return true;
    }
    const world = target.closest<HTMLElement>('[data-world-open]');
    if (world && state.manageView) {
      const item = state.manageView.items[Number(world.dataset.worldOpen)];
      return item ? openWorld(item.folder || null) : true;
    }
    const backup = target.closest<HTMLElement>('[data-world-backup]');
    if (backup && state.manageView) {
      const item = state.manageView.items[Number(backup.dataset.worldBackup)];
      return item
        ? manage.perform(
            'create_backup',
            { scope: 'world', world: item.folder },
            '存档备份已创建。',
          )
        : true;
    }
    const overview = target.closest<HTMLElement>('[data-instance-overview]');
    if (overview) return openOverview(overview.dataset.instanceOverview || '');
    const folder = target.closest<HTMLElement>('[data-open-version-folder]');
    if (folder)
      return (async () => {
        const view = state.instanceView;
        try {
          await invoke('open_version_folder', {
            gameDir:
              view && view.version === folder.dataset.openVersionFolder
                ? view.gameDir
                : state.gameDir,
            version: folder.dataset.openVersionFolder,
          });
        } catch (error) {
          flash(String(error), 'error');
        }
      })();
    const deleteButton = target.closest<HTMLElement>('[data-delete-version]');
    if (deleteButton) {
      options.versionDelete.open(deleteButton.dataset.deleteVersion || '');
      return true;
    }
    const exportButton = target.closest<HTMLElement>('[data-export-game]');
    if (exportButton) {
      options.archive.openExport(exportButton.dataset.exportGame || '');
      return true;
    }
    const select = target.closest<HTMLElement>('[data-select]');
    if (select) {
      state.selected = select.dataset.select || '';
      options.persist();
      render();
      void theme.load(state.gameDir, state.selected);
      flash(`已选择 ${state.selected}`);
      return true;
    }
    const install = target.closest<HTMLElement>('[data-install]');
    if (install) {
      state.installDraft = {
        version: install.dataset.install || '',
        loader: 'vanilla',
        addons: [],
      };
      renderOverlay();
      return true;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'cancel-version-delete':
        options.versionDelete.cancel();
        return true;
      case 'confirm-version-delete':
        return options.versionDelete.confirm(
          !!container.querySelector<HTMLInputElement>('#delete-instance-data')?.checked,
        );
      case 'close-instance-settings':
        state.instanceSettingsView = null;
        renderOverlay();
        return true;
      case 'reset-instance-settings':
        options.launchSettings.reset();
        return true;
      case 'close-instance':
        state.instanceView = null;
        renderOverlay();
        return true;
      case 'close-game-profile':
        if (state.profileView) {
          state.profileView.generation++;
          state.profileView = null;
          renderOverlay();
        }
        return true;
      case 'close-profile-preview':
        if (state.profileView) {
          state.profileView.preview = null;
          renderOverlay();
        }
        return true;
      case 'refresh-game-profile':
        if (state.profileView && !state.profileView.loading) {
          const view = state.profileView;
          void profile.loadStats(view);
          return profile.loadScreenshots(view);
        }
        return true;
      case 'open-screenshot-folder':
        return (async () => {
          const view = state.profileView;
          if (!view) return;
          try {
            await invoke('open_screenshot_folder', {
              gameDir: view.gameDir,
              version: view.version,
            });
          } catch (error) {
            flash(`无法打开截图目录：${error}`, 'error');
          }
        })();
      case 'close-instance-theme':
        theme.close();
        return true;
      case 'remove-instance-cover':
        theme.removeCover();
        return true;
      case 'save-instance-theme':
        return theme.save(
          String(container.querySelector<HTMLInputElement>('#instance-description')?.value || ''),
        );
      case 'close-manage':
        if (state.manageView && !state.manageView.busy) {
          state.manageView = null;
          renderOverlay();
        }
        return true;
      case 'switch-worlds':
        if (state.manageView && !state.manageView.busy)
          return manage.open('worlds', state.manageView.version, state.manageView.gameDir);
        return true;
      case 'switch-backups':
        if (state.manageView && !state.manageView.busy)
          return manage.open('backups', state.manageView.version, state.manageView.gameDir);
        return true;
      case 'refresh-manage':
        if (state.manageView && !state.manageView.busy) return manage.load();
        return true;
      case 'open-saves-folder':
        return openWorld(null);
      case 'create-instance-backup':
        return manage.perform(
          'create_backup',
          { scope: 'instance', world: null },
          '实例备份已创建。',
        );
      case 'manage-cancel':
        if (state.manageView && !state.manageView.busy) {
          state.manageView.confirm = null;
          renderOverlay();
        }
        return true;
      case 'manage-confirm':
        return confirmManage();
      default:
        return false;
    }
  };
}
