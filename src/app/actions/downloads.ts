import type { invoke } from '@tauri-apps/api/core';
import type { LauncherState } from '../../lib/launcher-state';
import type { createJobManager } from '../../job-manager';
import type { ClickHandler } from './types';
interface Options {
  state: LauncherState;
  invoke: typeof invoke;
  render: () => void;
  renderChrome: () => void;
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
      if (old?.run)
        jobs.enqueueJob({
          key: old.key,
          kind: old.kind,
          title: old.title,
          gameDir: old.gameDir,
          version: old.version,
          run: old.run,
          recipe: old.recipe,
        });
      return true;
    }
    const remove = target.closest<HTMLElement>('[data-remove-job]');
    if (remove) {
      state.jobs = state.jobs.filter(
        (job) =>
          job.id !== remove.dataset.removeJob ||
          !['done', 'failed', 'cancelled'].includes(job.status),
      );
      jobs.saveJobs();
      jobs.renderJobList();
      return true;
    }
    const cancel = target.closest<HTMLElement>('[data-cancel-job]');
    if (cancel) {
      const job = state.jobs.find((item) => item.id === cancel.dataset.cancelJob);
      return job ? jobs.requestJobCancel(job).then(() => jobs.pumpJobs()) : true;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    switch (action) {
      case 'cancel-all-jobs':
        return Promise.all(
          state.jobs
            .filter((job) => job.status === 'queued' || job.status === 'running')
            .map(jobs.requestJobCancel),
        ).then(() => jobs.pumpJobs());
      case 'clear-jobs':
        state.jobs = state.jobs.filter(
          (job) => !['done', 'failed', 'cancelled'].includes(job.status),
        );
        jobs.saveJobs();
        if (state.page === 'downloads') render();
        else renderChrome();
        return true;
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
