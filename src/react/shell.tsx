import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from './icons';
interface ShellProps {
  page: string;
  name: string;
  status: string;
  skin: string;
  version: string;
  installedCount: number;
  backgroundJobs: { id: string; title: string; status: string }[];
  foregroundActive: boolean;
  jobNotices: {
    id: string;
    title: string;
    message: string;
    error: string;
    status: string;
    run: unknown;
  }[];
  updateInfo: { available: boolean; latestVersion: string } | null;
  updateDismissed: string;
  notice: string;
  noticeKind: string;
  noticeCrash: boolean;
}
const navigation = [
  ['home', 'layout-grid', '启动游戏'],
  ['versions', 'layers-3', '版本管理'],
  ['content', 'blocks', '模组与资源'],
  ['multiplayer', 'globe-2', '多人联机'],
  ['java', 'monitor', 'Java 管理'],
  ['settings', 'settings', '启动设置'],
] as const;
function Avatar({ name, skin }: { name: string; skin: string }) {
  const [loaded, setLoaded] = useState('');
  return (
    <div
      className={`avatar${skin && loaded === skin ? ' has-skin' : ''}`}
      aria-label={`${name} 的头像`}
      data-skin={skin}
      data-name={name}
    >
      <span className="avatar-fallback">{name.slice(0, 1).toUpperCase()}</span>
      {skin && (
        <>
          <img
            className="avatar-skin avatar-face"
            alt=""
            draggable={false}
            src={skin}
            onLoad={() => flushSync(() => setLoaded(skin))}
            onError={() => flushSync(() => setLoaded(''))}
          />
          <img className="avatar-skin avatar-overlay" alt="" draggable={false} src={skin} />
        </>
      )}
    </div>
  );
}
export function Shell(p: ShellProps) {
  return (
    <div className="app-shell">
      <header className="window-bar">
        <div className="window-drag" data-tauri-drag-region>
          <span className="window-kicker" data-tauri-drag-region>
            CCL
          </span>
          <span className="window-separator" data-tauri-drag-region></span>
          <span className="window-title" data-tauri-drag-region>
            COMPASS CRAFT LAUNCHER
          </span>
        </div>
        <div className="window-controls">
          <button data-window="minimize" aria-label="最小化" title="最小化">
            <Icon name="minus" size={15} />
          </button>
          <button data-window="maximize" aria-label="最大化或还原" title="最大化或还原">
            <Icon name="square" size={12} />
          </button>
          <button data-window="close" className="window-close" aria-label="关闭" title="关闭">
            <Icon name="x" size={16} />
          </button>
        </div>
      </header>
      <aside className="sidebar" inert={p.foregroundActive}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"></div>
          <div>
            <strong>
              CCL<span>.</span>
            </strong>
            <small>COMPASS CRAFT LAUNCHER</small>
          </div>
        </div>
        <nav className="nav">
          {navigation.map(([page, icon, label]) => (
            <button key={page} data-page={page} className={p.page === page ? 'active' : ''}>
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="side-footer">
            <span>v{p.version}</span>
          </div>
        </div>
      </aside>
      <main className="main" inert={p.foregroundActive}>
        <header className="topbar">
          <div className="breadcrumbs">
            <strong>
              {p.page === 'account'
                ? '账户与外观'
                : navigation.find(([page]) => page === p.page)?.[2]}
            </strong>
          </div>
          <div className="top-right">
            <div id="update-slot" aria-live="polite">
              {p.updateInfo?.available && p.updateInfo.latestVersion !== p.updateDismissed && (
                <div className="update-pill">
                  <button type="button" data-action="open-update" title="打开 GitHub 下载页面">
                    <Icon name="download" size={14} />{' '}
                    <span>新版本 v{p.updateInfo.latestVersion}</span>
                  </button>
                  <button type="button" data-action="dismiss-update" aria-label="暂时隐藏更新提示">
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )}
            </div>
            {p.backgroundJobs.length > 0 && (
              <details className="background-downloads" data-background-jobs>
                <summary aria-label={`${p.backgroundJobs.length} 个后台任务`}>
                  后台下载 <span>{p.backgroundJobs.length}</span>
                </summary>
                <div className="background-download-list">
                  {p.backgroundJobs.map((job) => (
                    <div key={job.id}>
                      <span>
                        <strong>{job.title}</strong>
                        <small>
                          {job.status === 'queued'
                            ? '等待中'
                            : job.status === 'canceling'
                              ? '正在取消'
                              : '下载中'}
                        </small>
                      </span>
                      <button
                        type="button"
                        data-cancel-job={job.id}
                        disabled={job.status === 'canceling'}
                        aria-label={`取消 ${job.title}`}
                      >
                        取消
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <button
              type="button"
              className={`account-entry${p.page === 'account' ? ' active' : ''}`}
              data-page="account"
              aria-label={`账户与外观：${p.name}，${p.status}`}
              aria-current={p.page === 'account' ? 'page' : undefined}
            >
              <Avatar name={p.name} skin={p.skin} />
              <span className="account-entry-label" aria-hidden="true">
                账户与外观
              </span>
              <span className="profile sr-only">
                <strong>{p.name}</strong>
                <small>{p.status}</small>
              </span>
            </button>
          </div>
        </header>
        <div className="content"></div>
      </main>
      <div id="modal-root"></div>
      <div id="toast-root" inert={p.foregroundActive}>
        {p.jobNotices.map((job) => (
          <div
            className={`toast ${job.status === 'failed' ? 'error' : ''}`}
            key={job.id}
            role="status"
          >
            <span>
              {job.title}：{job.message}
              {job.error ? `：${job.error}` : ''}
            </span>
            {job.status === 'failed' && !!job.run && (
              <button className="toast-log" data-retry-job={job.id}>
                重试
              </button>
            )}
            <button data-dismiss-job={job.id} aria-label={`关闭 ${job.title} 通知`}>
              <Icon name="x" size={15} />
            </button>
          </div>
        ))}
        {p.notice && (
          <div className={`toast ${p.noticeKind}`}>
            {p.notice}
            {p.noticeCrash && (
              <>
                <button className="toast-log" data-action="open-crash-diagnosis">
                  查看诊断
                </button>
                <button className="toast-log" data-action="open-crash-log">
                  查看日志
                </button>
              </>
            )}
            <button data-action="dismiss" aria-label="关闭">
              <Icon name="x" size={15} />
            </button>
          </div>
        )}
      </div>
      {[
        ['n', 'North'],
        ['s', 'South'],
        ['e', 'East'],
        ['w', 'West'],
        ['nw', 'NorthWest'],
        ['ne', 'NorthEast'],
        ['sw', 'SouthWest'],
        ['se', 'SouthEast'],
      ].map(([key, direction]) => (
        <div key={key} className={`resize-edge resize-${key}`} data-resize={direction}></div>
      ))}
    </div>
  );
}
