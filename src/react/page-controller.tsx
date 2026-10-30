import { HomePage } from './home-page';
import { VersionsPage } from './versions-page';
import { JavaPage } from './java-page';
import { ContentPage } from './content';
import { DownloadsPage } from './downloads';
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
  function downloads() {
    if (!container.querySelector('#job-list') && state.page !== 'downloads') return;
    renderer.page(DownloadsPage, { jobs: state.jobs, limit: state.jobLimit }, 'downloads');
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
      });
      return;
    }
    if (state.page === 'content') {
      content();
      return;
    }
    if (state.page === 'downloads') {
      downloads();
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
  return { page, content, settings, downloads, servers, versions, search };
}
