import type { Job, JobProgress } from './job-manager.ts';

interface ProgressOptions {
  state: { jobs: Job[] };
  updateJob: (job: Job, patch: Partial<Job>) => void;
}

function formatRemaining(seconds: number) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

function showsDownloadSpeed(job: Job, message: string) {
  return (
    (job.kind === 'java' && message === '正在下载 Java') ||
    (['resourcepack', 'shader'].includes(job.kind) && message === '正在下载资源包')
  );
}

/** Convert native download progress into task state and speed estimates. */
export function createJobProgressHandler({ state, updateJob }: ProgressOptions) {
  function jobEvent(payload: JobProgress) {
    const job = state.jobs.find((j) => j.id === payload.jobId);
    if (!job || job.status !== 'running') return;
    const current = Number(payload.current) || 0,
      total = Number(payload.total) || 0,
      now = Date.now();
    let metrics = '';
    if (showsDownloadSpeed(job, payload.message)) {
      const previous = job.lastSample;
      if (
        previous &&
        now > previous.time &&
        current >= previous.current &&
        previous.total === total
      ) {
        const speed = ((current - previous.current) * 1000) / (now - previous.time);
        if (speed > 0) {
          const remaining = Math.max(0, Math.ceil((total - current) / speed));
          metrics = `${(speed / 1048576).toFixed(2)} MB/s`;
          if (total > 0) metrics += ` · 预计 ${formatRemaining(remaining)}`;
        }
      }
      job.lastSample = { time: now, current, total };
    } else job.lastSample = null;
    updateJob(job, { message: payload.message, current, total, metrics });
  }
  return jobEvent;
}
