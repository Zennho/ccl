import type { LauncherState } from '../../lib/launcher-state';
import { invoke } from '@tauri-apps/api/core';
import type { Job } from '../../job-manager';
import { createPackManager } from '../../lib/pack-manager';
import { createModManager } from '../../lib/mod-manager';
import { createContentSearch } from '../../lib/content-search';
import { createContentDetail } from '../../lib/content-detail';
import { createContentControls } from '../../lib/content-controls';

interface Options {
  state: LauncherState;
  render: () => void;
  renderContent: () => void;
  renderOverlay: () => void;
  flash: (message: string, kind?: string) => void;
}

export type ContentFeature = ReturnType<typeof createContentFeature>;

export function createContentFeature({
  state,
  render,
  renderContent,
  renderOverlay,
  flash,
}: Options) {
  const packManager = createPackManager({
    state,
    render: renderContent,
    renderPage: render,
    flash,
    invalidateContent: () => contentSearch.invalidate(),
    search: () => contentSearch.searchContent(),
    remove: (draft) => invoke('remove_local_pack', { ...draft }),
    updates: (gameDir, version, kind, apiKey) =>
      invoke('check_pack_updates', { gameDir, version, kind, apiKey }),
    list: (gameDir, version, kind) => invoke('list_local_packs', { gameDir, version, kind }),
    environment: (gameDir, version) => invoke('shader_environment', { gameDir, version }),
  });

  const modManager = createModManager({
    state,
    render: renderContent,
    search: () => contentSearch.searchContent(),
    flash,
    list: (gameDir, version) => invoke('list_mods', { gameDir, version }),
    remove: (gameDir, version, name) => invoke('remove_mod', { gameDir, version, name }),
    setEnabled: (gameDir, version, name, enabled) =>
      invoke('set_mod_enabled', { gameDir, version, name, enabled }),
    conflicts: (gameDir, version) => invoke('check_mod_conflicts', { gameDir, version }),
    updates: (gameDir, version) => invoke('check_mod_updates', { gameDir, version }),
  });
  const contentSearch = createContentSearch({
    state,
    modRevision: modManager.revision,
    render,
    renderContent,
    categories: (source, kind, apiKey) => invoke('content_categories', { source, kind, apiKey }),
    search: (snapshot) => invoke('search_content', { ...snapshot }),
    translate: (source, items) => invoke('translate_content_summaries', { source, items }),
  });

  const contentDetail = createContentDetail({
    state,
    render: renderOverlay,
    lookup: (source, kind, projectUrl, title) =>
      invoke('lookup_mcmod', { source, kind, projectUrl, title }),
    links: (source, projectId, apiKey) => invoke('content_links', { source, projectId, apiKey }),
    curseDescription: (projectId, apiKey) =>
      invoke('curseforge_description', { projectId, apiKey }),
    versions: (kind, gameDir, version, source, projectId, apiKey) =>
      invoke(kind === 'mod' ? 'list_mod_versions' : 'list_pack_versions', {
        gameDir,
        version,
        source,
        projectId,
        apiKey,
        ...(kind === 'mod' ? {} : { kind }),
      }),
    translate: (source, projectId, description, summary) =>
      invoke('translate_content', { source, projectId, description, summary }),
  });
  const contentControls = createContentControls({
    state,
    render,
    invalidateMods: modManager.invalidate,
    refreshMods: modManager.refreshMods,
    refreshPacks: packManager.refresh,
    loadCategories: contentSearch.loadContentCategories,
    search: contentSearch.searchContent,
  });

  // Keep the visible library in sync only when the completed job belongs to it.
  async function onJobFinished(job: Job) {
    const matchesTarget = job.version === state.contentTarget && job.gameDir === state.gameDir;
    if (!matchesTarget) return;

    const isVisible = state.page === 'content';
    const isCurrentPack =
      ['resourcepack', 'shader'].includes(job.kind) && state.contentKind === job.kind;
    if (isCurrentPack) {
      contentSearch.invalidate();
      state.contentLoaded = false;
      if (isVisible) {
        await Promise.all([packManager.refresh(), contentSearch.searchContent()]);
      }
      return;
    }

    if (job.kind === 'mod') {
      modManager.invalidate();
      state.modUpdates = null;
      state.modConflicts = null;
      if (isVisible) {
        await modManager.refreshMods();
        if (state.contentKind === 'shader') await packManager.refresh();
        await contentSearch.searchContent();
      }
    }
  }

  return {
    mods: modManager,
    packs: packManager,
    search: contentSearch,
    detail: contentDetail,
    controls: contentControls,
    onJobFinished,
  };
}
