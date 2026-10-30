import type { invoke } from '@tauri-apps/api/core';
import type { LauncherState } from '../../lib/launcher-state';
import type { createJobManager } from '../../job-manager';
import type { ClickHandler } from './types';
interface Options {
  state: LauncherState;
  invoke: typeof invoke;
  render: () => void;
  renderChrome: () => void;
  renderOverlay: () => void;
  persist: () => void;
  flash: (message: string, kind?: string) => void;
  refreshJava: () => Promise<unknown>;
  jobs: ReturnType<typeof createJobManager>;
}
export function createDownloadHandler({
  state,
  invoke,
  render,
  renderChrome,
  renderOverlay,
  persist,
  flash,
  refreshJava,
  jobs,
}: Options): ClickHandler {
  async function removeJava() {
    const java = state.javaDelete === null ? null : state.javaRuntimes[state.javaDelete];
    state.javaDelete = null;
    if (!java?.managed) return;
    try {
      await invoke('remove_java', { major: java.major });
      if (state.javaPath === java.path) {
        state.javaPath = 'java';
        persist();
      }
      state.notice = `Java ${java.major} 已删除。`;
      state.noticeKind = '';
      await refreshJava();
    } catch (error) {
      flash(`删除失败：${error}`, 'error');
    }
  }
  return (target) => {
    const javaSelect = target.closest<HTMLElement>('[data-java-select]');
    if (javaSelect) {
      const java = state.javaRuntimes[Number(javaSelect.dataset.javaSelect)];
      if (java) {
        state.javaPath = java.path;
        persist();
        render();
        flash(`已选择 Java ${java.version}`);
      }
      return true;
    }
    const javaRemove = target.closest<HTMLElement>('[data-java-remove]');
    if (javaRemove) {
      state.javaDelete = Number(javaRemove.dataset.javaRemove);
      render();
      return true;
    }
    const javaInstall = target.closest<HTMLElement>('[data-java-install]');
    if (javaInstall && !state.javaLoading) {
      const major = Number(javaInstall.dataset.javaInstall),
        recipe = { type: 'java' as const, major };
      jobs.enqueueJob({
        key: `java:${major}`,
        kind: 'java',
        title: `Java ${major} · Eclipse Temurin`,
        recipe,
        run: jobs.runnerFor(recipe),
      });
      if (state.page === 'java') render();
      return true;
    }
    const retry = target.closest<HTMLElement>('[data-retry-job]');
    if (retry) {
      const old = state.jobs.find((job) => job.id === retry.dataset.retryJob);
      if (old?.run) {
        state.jobNotices = state.jobNotices.filter((id) => id !== old.id);
        jobs.enqueueJob({
          key: old.key,
          kind: old.kind,
          title: old.title,
          gameDir: old.gameDir,
          version: old.version,
          run: old.run,
          recipe: old.recipe,
        });
      }
      return true;
    }
    const dismissJob = target.closest<HTMLElement>('[data-dismiss-job]');
    if (dismissJob) {
      state.jobNotices = state.jobNotices.filter((id) => id !== dismissJob.dataset.dismissJob);
      renderChrome();
      return true;
    }
    const cancel = target.closest<HTMLElement>('[data-cancel-job]');
    if (cancel) {
      const job = state.jobs.find((item) => item.id === cancel.dataset.cancelJob);
      return job ? jobs.requestJobCancel(job).then(() => jobs.pumpJobs()) : true;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'close-download-progress': {
        const current = state.jobs.find((job) => job.id === state.foregroundJobId);
        if (current && ['queued', 'running', 'canceling'].includes(current.status)) return true;
        state.foregroundJobId = null;
        renderOverlay();
        renderChrome();
        return true;
      }
      case 'refresh-java':
        return refreshJava().then(() => {});
      case 'cancel-java-remove':
        state.javaDelete = null;
        render();
        return true;
      case 'confirm-java-remove':
        return removeJava();
      default:
        return false;
    }
  };
}
