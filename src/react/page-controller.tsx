import { HomePage } from './home-page';
import { VersionsPage } from './versions-page';
import { JavaPage } from './java-page';
import { ContentPage } from './content';
import { SettingsPage, type SettingsProps } from './settings';
import { AccountPage } from './account';
import { LanRoomPage } from './lan-room';
import { PublicServersPage, type PublicServer } from './public-servers';
import type { GameVersion } from './types';
import type { LauncherState } from '../lib/launcher-state';
import type { createRenderer } from './renderer';
interface Options {
  container: HTMLElement;
  state: LauncherState;
  renderer: ReturnType<typeof createRenderer>;
  theme: SettingsProps['theme'];
  appVersion: string;
  versionVisual: (version?: GameVersion) => { color: string; cover?: string | null };
  getInstanceTheme: (gameDir: string, version: string) => { description: string };
  hasJob: (key: string) => boolean;
  usingOnline: () => boolean;
  playerName: () => string;
  playerStatus: () => string;
  isSkinSyncEnabled: (gameDir: string, version: string) => boolean;
  filteredServers: () => PublicServer[];
  hydrateThumbnails: () => void;
}
export function createPageController({
  container,
  state,
  renderer,
  theme,
  appVersion,
  versionVisual,
  getInstanceTheme,
  hasJob,
  usingOnline,
  playerName,
  playerStatus,
  isSkinSyncEnabled,
  filteredServers,
  hydrateThumbnails,
}: Options) {
  const selected = () => state.versions.find((version) => version.id === state.selected);
  function content() {
    if (state.page === 'content' && container.querySelector('.content')) {
      renderer.page(ContentPage, { state }, 'content');
      hydrateThumbnails();
    }
  }
  function settings() {
    renderer.page(
      SettingsPage,
      {
        ...state,
        version: appVersion,
        selectedVersion: state.versions.find((v) => v.id === state.selected && v.installed),
        theme,
      },
      'settings',
    );
  }
  function servers() {
    renderer.page(
      PublicServersPage,
      {
        catalog: state.serverCatalog,
        filtered: filteredServers(),
        query: state.serverQuery,
        status: state.serverStatus,
        page: state.serverPage,
        loading: state.serverLoading,
        error: state.serverError,
      },
      'public-servers',
    );
  }
  function versions() {
    renderer.page(
      VersionsPage,
      {
        versions: state.versions,
        query: state.versionQuery,
        selected: state.selected,
        loading: state.loading,
        online: state.online,
        versionVisual,
        deleteVersion: state.versionDelete,
        deleting: state.versionDeleting,
      },
      'versions',
    );
  }
  function page() {
    if (state.page === 'home') {
      const version = selected();
      renderer.page(HomePage, {
        version,
        versions: state.versions,
        accountStatus: playerStatus(),
        visual: versionVisual(version),
        description: version?.installed
          ? getInstanceTheme(state.gameDir, version.id).description
          : '',
      });
      return;
    }
    if (state.page === 'versions') {
      versions();
      return;
    }
    if (state.page === 'java') {
      renderer.page(JavaPage, {
        runtimes: state.javaRuntimes,
        javaPath: state.javaPath,
        loading: state.javaLoading,
        deleteIndex: state.javaDelete,
        hasJob,
        selectedVersion: selected(),
        requiredJava: state.javaRequirement,
        requirementLoading: state.javaRequirementLoading,
      });
      return;
    }
    if (state.page === 'content') {
      content();
      return;
    }
    if (state.page === 'settings') {
      settings();
      return;
    }
    if (state.page === 'account') {
      renderer.page(AccountPage, {
        state,
        usingOnline: usingOnline(),
        playerName: playerName(),
        selected: selected(),
        skinSyncEnabled: isSkinSyncEnabled(state.gameDir, state.selected),
      });
      return;
    }
    if (state.page === 'multiplayer' && state.lanView === 'room') {
      renderer.page(LanRoomPage, {
        room: state.lanRoom,
        busy: state.lanBusy,
        addresses: state.lanAddresses,
        port: state.lanPort,
        target: state.lanTarget,
        test: state.lanTest,
      });
      return;
    }
    if (state.page === 'multiplayer' && state.lanView === 'servers') {
      servers();
      return;
    }
    renderer.page();
  }
  function search(kind: 'server' | 'version') {
    if (kind === 'server') {
      servers();
      hydrateThumbnails();
    } else versions();
  }
  return { page, content, settings, servers, versions, search };
}
