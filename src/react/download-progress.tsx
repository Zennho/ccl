import React, { useEffect, useRef } from 'react';
import { Icon } from './icons';
import type { Job } from '../job-manager';

/** A blocking, cancellable view for installing a game or modpack. */
export function DownloadProgress({ job }: { job: Job }) {
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    action.current?.focus();
  }, [job.id]);
  const active = ['queued', 'running', 'canceling'].includes(job.status);
  const progress =
    job.total > 0 ? Math.max(0, Math.min(100, (job.current / job.total) * 100)) : null;
  return (
    <div className="install-overlay download-progress-backdrop">
      <section
        className="install-dialog download-progress-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-progress-title"
        aria-describedby="download-progress-status"
      >
        <div className="download-progress-mark">
          <Icon name="download" size={25} />
        </div>
        <span className="section-index">INSTALL / CCL</span>
        <h2 id="download-progress-title">
          {job.status === 'done'
            ? '安装完成'
            : job.status === 'failed'
              ? '安装未完成'
              : job.status === 'cancelled'
                ? '已取消安装'
                : '正在安装'}
        </h2>
        <p className="download-progress-title">{job.title}</p>
        <div className="download-progress-status" id="download-progress-status" aria-live="polite">
          {job.message}
        </div>
        {job.error && <div className="download-progress-error">{job.error}</div>}
        {(active || job.status === 'done') && (
          <>
            <div
              className="download-progress-track"
              role="progressbar"
              aria-label="安装进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress === null ? undefined : Math.round(progress)}
            >
              <i
                className={progress === null ? 'indeterminate' : ''}
                style={{ width: `${progress === null ? 30 : progress}%` }}
              />
            </div>
            <div className="download-progress-caption">
              <span>
                {job.total > 0
                  ? `${job.current} / ${job.total} 项`
                  : job.status === 'queued'
                    ? '等待下载任务空位'
                    : '正在处理…'}
              </span>
              <span>{job.metrics || ''}</span>
            </div>
          </>
        )}
        <div className="install-actions">
          {active ? (
            <button
              ref={action}
              className="outline-btn"
              data-cancel-job={job.id}
              disabled={job.status === 'canceling'}
            >
              {job.status === 'canceling' ? '正在取消…' : '取消安装'}
            </button>
          ) : (
            <>
              <button ref={action} className="outline-btn" data-action="close-download-progress">
                {job.status === 'done' ? '完成' : '关闭'}
              </button>
              {job.status === 'failed' && job.run && (
                <button className="save-button" data-retry-job={job.id}>
                  重试
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
