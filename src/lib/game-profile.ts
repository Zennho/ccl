import type { GameVersion } from '../react/types';
export interface PlayStats {
  seconds?: number;
  launches?: number;
  lastStarted?: number;
  lastDuration?: number | null;
}
export interface ProfileView {
  version: string;
  gameDir: string;
  name: string;
  isolated: boolean;
  stats: PlayStats | null;
  statsError: string;
  page: number;
  shots: { name: string }[];
  images: Record<number, string>;
  imageErrors: Record<number, boolean>;
  generation: number;
  loadingGeneration?: number | null;
  hasMore: boolean;
  loading: boolean;
  error: string;
  preview: { data: string; name: string } | null;
}
interface State {
  versions: GameVersion[];
  gameDir: string;
  profileView: ProfileView | null;
}
interface Options {
  state: State;
  render: () => void;
  list: (
    gameDir: string,
    version: string,
    page: number,
  ) => Promise<{ items: { name: string }[]; hasMore: boolean; isolated: boolean }>;
  screenshot: (gameDir: string, version: string, name: string) => Promise<unknown>;
  stats: (gameDir: string, version: string) => Promise<PlayStats | null>;
}
export function createGameProfile({ state, render, list, screenshot, stats }: Options) {
  async function hydrate(view: ProfileView, generation: number) {
    if (view.loadingGeneration === generation) return;
    view.loadingGeneration = generation;
    let next = 0;
    const worker = async () => {
      while (next < view.shots.length) {
        const i = next++,
          shot = view.shots[i];
        try {
          const data = await screenshot(view.gameDir, view.version, shot.name);
          if (state.profileView !== view || generation !== view.generation) return;
          if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,'))
            throw new Error('截图不可用');
          view.images[i] = data;
          render();
        } catch {
          if (state.profileView !== view || generation !== view.generation) return;
          view.imageErrors[i] = true;
          render();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, view.shots.length) }, worker));
    if (view.loadingGeneration === generation) view.loadingGeneration = null;
  }
  async function loadScreenshots(view: ProfileView) {
    const generation = ++view.generation,
      page = view.page;
    view.loading = true;
    view.error = '';
    view.shots = [];
    view.images = {};
    view.imageErrors = {};
    render();
    try {
      const result = await list(view.gameDir, view.version, page);
      if (state.profileView !== view || generation !== view.generation) return;
      view.shots = Array.isArray(result?.items) ? result.items : [];
      view.hasMore = !!result?.hasMore;
      view.isolated = !!result?.isolated;
    } catch (error) {
      if (state.profileView === view && generation === view.generation) {
        view.error = String(error);
        view.hasMore = false;
      }
    } finally {
      if (state.profileView === view && generation === view.generation) {
        view.loading = false;
        render();
        void hydrate(view, generation);
      }
    }
  }
  async function loadStats(view: ProfileView) {
    try {
      const value = await stats(view.gameDir, view.version);
      if (state.profileView === view) {
        view.stats = value || {};
        view.statsError = '';
        render();
      }
    } catch (error) {
      if (state.profileView === view) {
        view.statsError = String(error);
        render();
      }
    }
  }
  async function open(version: string) {
    const item = state.versions.find((v) => v.id === version && v.installed);
    if (!item) return;
    const view: ProfileView = {
      version,
      gameDir: state.gameDir,
      name: item.name || version,
      isolated: !!item.isolated,
      stats: null,
      statsError: '',
      page: 0,
      shots: [],
      images: {},
      imageErrors: {},
      generation: 0,
      hasMore: false,
      loading: true,
      error: '',
      preview: null,
    };
    state.profileView = view;
    render();
    void loadStats(view);
    await loadScreenshots(view);
  }
  return { open, loadScreenshots, loadStats };
}
