import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from './icons';
interface ShellProps {
  page: string;
  name: string;
  status: string;
  skin: string;
  online: boolean;
  version: string;
  installedCount: number;
  jobCount: number;
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
  ['downloads', 'download', '下载任务'],
  ['java', 'monitor', 'Java 管理'],
  ['account', 'user-round', '账户与外观'],
  ['settings', 'settings-2', '启动设置'],
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
      <aside className="sidebar">
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
              {page === 'downloads' && (
                <b className={`job-badge${p.jobCount ? ' has-jobs' : ''}`}>{p.jobCount || ''}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="side-footer">
            <span className="status-dot"></span> {p.online ? '版本服务已连接' : '本地工作区'}{' '}
            <span>v{p.version}</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <strong>{navigation.find(([page]) => page === p.page)?.[2]}</strong>
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
            <Avatar name={p.name} skin={p.skin} />
            <div className="profile">
              <strong>{p.name}</strong>
              <small>{p.status}</small>
            </div>
          </div>
        </header>
        <div className="content"></div>
      </main>
      <div id="modal-root"></div>
      <div id="toast-root">
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
