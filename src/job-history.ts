import type { Job, Recipe } from './job-manager.ts';

interface HistoryState {
  jobs: Job[];
}
interface HistoryOptions {
  state: HistoryState;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  runnerFor: (recipe: Recipe | undefined) => ((job: Job) => Promise<unknown>) | null;
}

/** Persist non-sensitive job metadata and restore unfinished jobs as retryable failures. */
export function createJobHistory({ state, storage, runnerFor }: HistoryOptions) {
  function saveJobs() {
    try {
      storage.setItem(
        'ccl-job-history',
        JSON.stringify(
          state.jobs
            .slice(-100)
            .map(({ id, key, kind, title, status, gameDir, version, recipe }) => ({
              id,
              key,
              kind,
              title,
              status,
              gameDir,
              version,
              recipe,
            })),
        ),
      );
    } catch {}
  }
  function restoreJobs() {
    try {
      const list = JSON.parse(storage.getItem('ccl-job-history') || '[]');
      if (!Array.isArray(list)) return;
      state.jobs = list
        .slice(-100)
        .filter((j) => j && typeof j.title === 'string' && typeof j.id === 'string')
        .map((job) => {
          const interrupted = ['queued', 'running', 'canceling'].includes(job.status);
          let message = '上次运行的任务记录';
          if (interrupted) {
            message = job.recipe
              ? '任务因启动器关闭而中断，请重试。'
              : '任务因启动器关闭而中断，请重新添加。';
          }
          return {
            ...job,
            status: interrupted ? 'failed' : job.status,
            message,
            error: '',
            current: 0,
            total: 0,
            run: runnerFor(job.recipe),
          };
        });
    } catch {}
  }
  return { saveJobs, restoreJobs };
}
