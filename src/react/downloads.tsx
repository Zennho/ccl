import React from 'react';
import { Icon } from './icons';

type Status = 'queued' | 'running' | 'canceling' | 'cancelled' | 'done' | 'failed';
interface DownloadJob {
  id: string;
  kind: string;
  title: string;
  status: Status;
  current: number;
  total: number;
  message?: string;
  metrics?: string;
  error?: string;
  run?: unknown;
}
const labels: Record<Status, string> = {
  queued: '等待中',
  running: '进行中',
  canceling: '正在取消',
  cancelled: '已取消',
  done: '已完成',
  failed: '失败',
};
function jobCount(job: DownloadJob) {
  const bytes = ['java', 'resourcepack', 'shader'].includes(job.kind);
  if (!job.total)
    return job.status === 'queued'
      ? '排队中'
      : job.status === 'done'
        ? '完成'
        : bytes && job.current > 0
          ? `${(job.current / 1048576).toFixed(1)} MB`
          : '—';
  return bytes
    ? `${(job.current / 1048576).toFixed(1)} / ${(job.total / 1048576).toFixed(1)} MB`
    : `${job.current} / ${job.total} 项`;
}
function JobCard({ job }: { job: DownloadJob }) {
  const percent = job.total ? Math.min(100, Math.round((job.current / job.total) * 100)) : 0;
  const active = ['queued', 'running', 'canceling'].includes(job.status),
    ended = ['failed', 'cancelled', 'done'].includes(job.status);
  return (
    <article className={`job-card ${job.status}`} data-job-id={job.id}>
      <div className="job-top">
        <div className="job-icon">
          <Icon
            name={job.kind === 'java' ? 'monitor' : job.kind === 'mod' ? 'blocks' : 'box'}
            size={18}
          />
        </div>
        <div className="job-info">
          <strong>{job.title}</strong>
          <small className="job-message">{job.message || labels[job.status]}</small>
        </div>
        <span className="job-state">{labels[job.status]}</span>
      </div>
      <div className="job-progress-line">
        <div className="progress-track">
          <i
            className={`job-track${active && !job.total ? ' indeterminate' : ''}`}
            style={{
              width: `${active && !job.total ? 30 : job.status === 'done' ? 100 : percent}%`,
            }}
          />
        </div>
        <span className="job-count">{jobCount(job)}</span>
      </div>
      <div className="job-metrics">{job.metrics || ''}</div>
      {job.error && (
        <details className="job-error">
          <summary>{job.error.split('\n')[0].slice(0, 120)}</summary>
          <p>{job.error}</p>
        </details>
      )}
      <div className="job-actions">
        {active && (
          <button
            className="row-button"
            data-cancel-job={job.id}
            disabled={job.status === 'canceling'}
          >
            {job.status === 'canceling' ? '正在取消…' : '取消任务'}
          </button>
        )}
        {['failed', 'cancelled'].includes(job.status) && Boolean(job.run) && (
          <button className="row-button" data-retry-job={job.id}>
            <Icon name="refresh-cw" size={14} /> 重试
          </button>
        )}
        {ended && (
          <button className="row-button" data-remove-job={job.id}>
            移除记录
          </button>
        )}
      </div>
    </article>
  );
}
export function DownloadsPage({ jobs, limit }: { jobs: DownloadJob[]; limit: number }) {
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'canceling').length,
    active = jobs.some((j) => ['queued', 'running', 'canceling'].includes(j.status));
  const recent = jobs.slice().reverse();
  const activeJobs = recent.filter((job) =>
    ['queued', 'running', 'canceling'].includes(job.status),
  );
  const finishedJobs = recent
    .filter((job) => !['queued', 'running', 'canceling'].includes(job.status))
    .sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'));
  return (
    <>
      <div className="page-heading inner-heading">
        <div>
          <h1>下载任务</h1>
          <p className="job-summary">
            {running} 个任务进行中，最多同时运行 {limit} 个。
          </p>
        </div>
        <div className="heading-actions">
          <button className="outline-btn" data-action="cancel-all-jobs" disabled={!active}>
            取消全部
          </button>
          <button className="outline-btn" data-action="clear-jobs">
            清除已结束
          </button>
        </div>
      </div>
      <div className="job-settings">
        <label htmlFor="job-limit">同时运行任务</label>
        <select id="job-limit" defaultValue={limit}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option value={n} key={n}>
              {n} 个
            </option>
          ))}
        </select>
        <span>修改后对等待中的任务生效</span>
      </div>
      <div id="job-list">
        {jobs.length ? (
          <>
            <section data-job-group="active">
              <div className="section-title">
                <h3>
                  进行中 <span className="count">{activeJobs.length}</span>
                </h3>
              </div>
              {activeJobs.length ? (
                activeJobs.map((job) => <JobCard key={job.id} job={job} />)
              ) : (
                <p className="jobs-group-empty">暂无进行中的任务</p>
              )}
            </section>
            <section data-job-group="finished">
              <div className="section-title">
                <h3>
                  已结束 <span className="count">{finishedJobs.length}</span>
                </h3>
              </div>
              {finishedJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </section>
          </>
        ) : (
          <div className="empty-state job-empty">
            <Icon name="download" size={27} />
            <strong>还没有下载任务</strong>
            <p>选择游戏、Java 或模组后即可加入任务列表。</p>
          </div>
        )}
      </div>
    </>
  );
}
